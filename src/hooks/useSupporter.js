'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';

// Global cache shared by all useSupporter consumers — no polling, refreshed on demand
const globalCache = {
  data: null, // { isSupporter, isAdmin, expiresAt }
  timestamp: 0,
  pendingPromise: null,
  subscribers: new Set(),
};

const notifyAll = (data) => {
  globalCache.data = data;
  globalCache.timestamp = Date.now();
  globalCache.subscribers.forEach((cb) => cb(data));
};

/**
 * Supporter status for the current user.
 * - Guests / signed-out → not a supporter
 * - Initial value comes from the session hint (sign-in time); the API is the
 *   source of truth and is fetched on mount + window focus + manual refresh()
 */
export function useSupporter(options = {}) {
  const { data: session, status: sessionStatus } = useSession();
  const [state, setState] = useState(
    globalCache.data || { isSupporter: !!session?.user?.isSupporter, isAdmin: false, expiresAt: null }
  );
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const isGuest = sessionStatus === 'unauthenticated';

  const refresh = useCallback(async () => {
    if (sessionStatus !== 'authenticated') return null;
    if (globalCache.pendingPromise) return globalCache.pendingPromise;

    setLoading(true);
    globalCache.pendingPromise = (async () => {
      try {
        const res = await fetch('/api/user/supporter', { credentials: 'include' });
        const data = await res.json();
        const next = data.success
          ? { isSupporter: !!data.isSupporter, isAdmin: !!data.isAdmin, expiresAt: data.expiresAt || null }
          : { isSupporter: false, isAdmin: false, expiresAt: null };
        if (mountedRef.current) {
          setState(next);
          setLoading(false);
        }
        notifyAll(next);
        return next;
      } catch {
        if (mountedRef.current) setLoading(false);
        return null;
      } finally {
        globalCache.pendingPromise = null;
      }
    })();
    return globalCache.pendingPromise;
  }, [sessionStatus]);

  useEffect(() => {
    mountedRef.current = true;
    const handleUpdate = (data) => {
      if (mountedRef.current) setState(data);
    };
    globalCache.subscribers.add(handleUpdate);

    if (sessionStatus === 'authenticated') {
      if (globalCache.data && Date.now() - globalCache.timestamp < 60000) {
        setState(globalCache.data);
      } else {
        refresh();
      }
    } else if (sessionStatus === 'unauthenticated') {
      setState({ isSupporter: false, isAdmin: false, expiresAt: null });
    }

    return () => {
      mountedRef.current = false;
      globalCache.subscribers.delete(handleUpdate);
    };
  }, [sessionStatus, refresh]);

  // Refresh on window focus (cheap — server caches for 5 min)
  useEffect(() => {
    if (!options.refreshOnFocus || sessionStatus !== 'authenticated') return;
    const onFocus = () => {
      if (Date.now() - globalCache.timestamp > 60000) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [options.refreshOnFocus, sessionStatus, refresh]);

  return {
    isSupporter: isGuest ? false : !!state.isSupporter,
    isAdmin: !!state.isAdmin,
    expiresAt: state.expiresAt,
    loading,
    refresh,
  };
}
