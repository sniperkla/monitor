'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const CACHE_DURATION = 5000; // 5 seconds for memory cache
const STORAGE_KEY = 'ai_usage_cache';
const SESSION_INIT_KEY = 'ai_usage_init_started';
const BROADCAST_CHANNEL = 'ai_usage_sync';

// Load initial cache from localStorage (persists across page reloads)
const loadStoredCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Only use if less than 5 minutes old
      if (Date.now() - parsed.timestamp < 300000) {
        return parsed;
      }
    }
  } catch (e) {
    // Ignore storage errors
  }
  return null;
};

// Global in-memory cache
const stored = loadStoredCache();
const globalCache = {
  data: stored ? { used: stored.used, limit: stored.limit } : null,
  timestamp: stored ? stored.timestamp : 0,
  pendingPromise: null,
  subscribers: new Set(),
};

// Save cache to localStorage
const saveCache = (data) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      used: data.used,
      limit: data.limit,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // Ignore storage errors
  }
};

// Check if another instance is already initializing
const isAnotherInstanceInitializing = () => {
  if (typeof window === 'undefined') return false;
  const initStart = sessionStorage.getItem(SESSION_INIT_KEY);
  if (!initStart) return false;
  // If init started within last 5 seconds, consider it active
  return Date.now() - Number(initStart) < 5000;
};

// Mark initialization started
const markInitializing = () => {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_INIT_KEY, Date.now().toString());
};

// Clear initialization mark
const clearInitializing = () => {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_INIT_KEY);
};

export function useAIUsage() {
  const [usage, setUsage] = useState(globalCache.data || { used: 0, limit: 10000 });
  const [loading, setLoading] = useState(!globalCache.data);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const broadcastChannelRef = useRef(null);

  // Function to update usage and notify subscribers
  const updateUsage = useCallback((newUsage) => {
    globalCache.data = newUsage;
    globalCache.timestamp = Date.now();
    saveCache(newUsage);
    globalCache.subscribers.forEach(cb => cb(newUsage));
    setUsage(newUsage);
    setLoading(false);
  }, []);

  // Fetch function with deduplication
  const fetchUsage = useCallback(async (force = false) => {
    // Return cached data if still fresh
    if (!force && globalCache.data && Date.now() - globalCache.timestamp < CACHE_DURATION) {
      setUsage(globalCache.data);
      setLoading(false);
      return globalCache.data;
    }

    // Return existing promise if already fetching
    if (globalCache.pendingPromise) {
      return globalCache.pendingPromise;
    }

    setLoading(true);
    setError(null);

    // Create new fetch promise
    globalCache.pendingPromise = (async () => {
      try {
        const res = await fetch('/api/user/ai-usage');
        const data = await res.json();
        
        if (!mountedRef.current) return null;

        if (data.success) {
          const newUsage = { used: data.used, limit: data.limit };
          updateUsage(newUsage);
          
          // Broadcast to other tabs
          try {
            const channel = new BroadcastChannel(BROADCAST_CHANNEL);
            channel.postMessage({ type: 'sync', used: data.used, limit: data.limit });
            channel.close();
          } catch (e) {
            // BroadcastChannel not supported
          }
          
          return newUsage;
        } else {
          throw new Error(data.error || 'Failed to fetch');
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err.message);
        }
        return null;
      } finally {
        globalCache.pendingPromise = null;
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    })();

    return globalCache.pendingPromise;
  }, [updateUsage]);

  useEffect(() => {
    mountedRef.current = true;

    // Register as subscriber for cache updates
    const handleCacheUpdate = (newUsage) => {
      if (mountedRef.current) {
        setUsage(newUsage);
      }
    };
    globalCache.subscribers.add(handleCacheUpdate);

    // Setup broadcast channel listener
    try {
      broadcastChannelRef.current = new BroadcastChannel(BROADCAST_CHANNEL);
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data?.type === 'sync') {
          const newUsage = { used: event.data.used, limit: event.data.limit };
          globalCache.data = newUsage;
          globalCache.timestamp = Date.now();
          saveCache(newUsage);
          globalCache.subscribers.forEach(cb => cb(newUsage));
        }
      };
    } catch (e) {
      // BroadcastChannel not supported
    }

    // Only fetch if:
    // 1. No cached data at all, AND
    // 2. No other instance is already fetching (using sessionStorage coordination)
    if (!globalCache.data && !isAnotherInstanceInitializing() && !globalCache.pendingPromise) {
      markInitializing();
      fetchUsage().finally(() => {
        // Clear the initializing mark after a delay to allow other instances to see the cache
        setTimeout(clearInitializing, 1000);
      });
    } else if (globalCache.data) {
      // Use cached data immediately
      setUsage(globalCache.data);
      setLoading(false);
    }

    return () => {
      mountedRef.current = false;
      globalCache.subscribers.delete(handleCacheUpdate);
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, [fetchUsage]);

  return { usage, loading, error, refresh: () => fetchUsage(true) };
}

// Hook for polling with cross-tab coordination and optional notifications
export function useAIUsagePolling(interval = 60000, onThresholdCrossed = null) {
  const { usage, refresh } = useAIUsage();
  const lastPollRef = useRef(0);
  const intervalRef = useRef(null);
  const thresholdRef = useRef({ lastBucket: -1, lastDayKey: '' });

  const getDayKey = useCallback(() => {
    const d = new Date();
    const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const poll = async () => {
      const now = Date.now();
      
      // Check localStorage for cross-tab coordination
      const lastGlobalPoll = Number(localStorage.getItem('ai_usage_last_poll') || 0);
      
      // Skip if another tab polled recently (within 55 seconds)
      if (now - lastGlobalPoll < 55000) {
        return;
      }

      // Skip if we already polled recently
      if (now - lastPollRef.current < 55000) {
        return;
      }

      localStorage.setItem('ai_usage_last_poll', now.toString());
      lastPollRef.current = now;

      const newUsage = await refresh();
      
      // Check threshold notifications
      if (newUsage && onThresholdCrossed) {
        const percent = Math.min(100, Math.floor((newUsage.used / newUsage.limit) * 100));
        const bucket = Math.min(5, Math.floor(percent / 20));
        const dayKey = getDayKey();

        if (thresholdRef.current.lastDayKey !== dayKey) {
          thresholdRef.current = { lastBucket: -1, lastDayKey: dayKey };
        }

        const prevBucket = thresholdRef.current.lastBucket;
        thresholdRef.current.lastBucket = bucket;

        if (bucket > prevBucket && bucket > 0) {
          const targetPercent = Math.min(100, bucket * 20);
          onThresholdCrossed({
            percent: targetPercent,
            used: newUsage.used,
            limit: newUsage.limit,
            type: targetPercent >= 80 ? 'warning' : 'info',
          });
        }
      }
    };

    // Initial poll with delay to stagger page load
    const initialDelay = setTimeout(poll, 2000);

    // Set up interval
    intervalRef.current = setInterval(poll, interval);

    return () => {
      clearTimeout(initialDelay);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [interval, refresh, onThresholdCrossed, getDayKey]);

  return usage;
}
