'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { encryptWithPassword, decryptWithPassword, hashPassword } from '@/utils/clientCrypto';

const VaultContext = createContext();

/**
 * VaultProvider manages the zero-knowledge vault lifecycle:
 * 
 * States:
 * - LOCKED: User is logged in but hasn't entered Master Password
 * - UNLOCKED: Master Password verified, decrypted URI in memory
 * - SETUP: User needs to configure vault for the first time
 * - NO_AUTH: User not logged in (no vault needed)
 */
export function VaultProvider({ children }) {
  const { data: session, status: authStatus } = useSession();
  
  // Vault state
  const [vaultStatus, setVaultStatus] = useState('loading'); // loading, no_auth, setup, locked, unlocked
  const [decryptedUri, setDecryptedUri] = useState(''); // Only exists in memory!
  const [decryptedTunnel, setDecryptedTunnel] = useState(null); // SSH tunnel config, only in memory
  const [vaultData, setVaultData] = useState(null); // Server-side encrypted data
  const [hasLegacyUri, setHasLegacyUri] = useState(false);
  const [legacyUri, setLegacyUri] = useState('');
  const [isDismissed, setIsDismissed] = useState(false);
  const [error, setError] = useState('');
  const prevUserIdRef = useRef(null);
  const masterPwdRef = useRef(null); // Cached for sync operations (memory only, never persisted)
  const hasFetchedRef = useRef(false); // Track if we've already fetched vault data
  const vaultStatusRef = useRef('loading'); // Ref to track current status synchronously

  // Keep vaultStatusRef in sync with vaultStatus state
  useEffect(() => {
    vaultStatusRef.current = vaultStatus;
  }, [vaultStatus]);

  // Clear stale vault cache when user changes (different account login)
  useEffect(() => {
    const currentUserId = session?.user?.id || session?.user?.email || null;
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId) {
      sessionStorage.removeItem('_vault_uri');
      sessionStorage.removeItem('_vault_tunnel');
      setDecryptedUri('');
      setDecryptedTunnel(null);
      setVaultData(null);
      hasFetchedRef.current = false; // Reset fetch flag for new user
    }
    prevUserIdRef.current = currentUserId;
  }, [session]);

  // Fetch vault data when user status changes
  useEffect(() => {
    if (authStatus === 'loading') {
      setVaultStatus('loading');
      return;
    }

    if (!session) {
      // GUEST MODE: Check for Local Vault
      const localVault = localStorage.getItem('ssh_monitor_local_vault');
      if (localVault) {
        try {
          const parsed = JSON.parse(localVault);
          setVaultData(parsed);
          
          // Check session cache
          const cached = sessionStorage.getItem('_vault_uri');
          if (cached) {
            setDecryptedUri(cached);
            const cachedTunnel = sessionStorage.getItem('_vault_tunnel');
            if (cachedTunnel) {
              try { setDecryptedTunnel(JSON.parse(cachedTunnel)); } catch (_) {}
            }
            setVaultStatus('unlocked');
          } else {
            setVaultStatus('locked');
          }
        } catch (e) {
          setVaultStatus('no_auth');
        }
      } else {
        setVaultStatus('no_auth');
        setDecryptedUri('');
        setVaultData(null);
      }
      return;
    }

    // AUTH MODE: User is logged in — fetch cloud vault
    
    // Optimistic unlock: Check storage immediately so we don't wait for API
    // This fixes "refresh locks vault" issues by restoring state instantly
    try {
      if (typeof window !== 'undefined') {
        const cached = window.sessionStorage.getItem('_vault_uri');
        if (cached) {
          console.log('🔓 [Vault] Optimistically unlocking from session storage');
          setDecryptedUri(cached);
          const cachedTunnel = window.sessionStorage.getItem('_vault_tunnel');
          if (cachedTunnel) {
            try { setDecryptedTunnel(JSON.parse(cachedTunnel)); } catch (_) {}
          }
          // Restore master password for sync operations
          try {
            const encodedPwd = window.sessionStorage.getItem('_vault_pwd');
            if (encodedPwd) masterPwdRef.current = atob(encodedPwd);
          } catch (_) {}
          setVaultStatus('unlocked');
          vaultStatusRef.current = 'unlocked'; // Update ref immediately
        }
      }
    } catch (e) {
      console.warn('[Vault] Storage check failed:', e);
    }

    // Skip re-fetch if already fetched and unlocked (avoids popup on tab switch)
    // Use ref to get the most current value since state updates are async
    if (hasFetchedRef.current && vaultStatusRef.current === 'unlocked') {
      return;
    }

    fetchVault();
    hasFetchedRef.current = true;
  }, [session, authStatus]);

  const fetchVault = useCallback(async () => {
    // If already unlocked with cached data, don't risk resetting to setup
    const cachedUri = sessionStorage.getItem('_vault_uri');
    
    try {
      const res = await fetch('/api/user/vault');
      const data = await res.json();

      if (!data.success) {
        // Don't reset to setup if we have cached unlock data
        if (cachedUri) {
          setVaultStatus('unlocked');
          vaultStatusRef.current = 'unlocked';
        } else if (vaultData?.isConfigured) {
          setVaultStatus('locked');
          vaultStatusRef.current = 'locked';
        }
        return;
      }

      setVaultData(data.data.vault);
      setHasLegacyUri(data.data.hasLegacyUri);
      if (data.data.legacyUri) setLegacyUri(data.data.legacyUri);

      if (data.data.vault.isConfigured) {
        // Check if we have a cached unlock in sessionStorage
        if (cachedUri) {
          setDecryptedUri(cachedUri);
          const cachedTunnel = sessionStorage.getItem('_vault_tunnel');
          if (cachedTunnel) {
            try { setDecryptedTunnel(JSON.parse(cachedTunnel)); } catch (_) {}
          }
          // Restore master password for sync operations
          try {
            const encodedPwd = sessionStorage.getItem('_vault_pwd');
            if (encodedPwd) masterPwdRef.current = atob(encodedPwd);
          } catch (_) {}
          setVaultStatus('unlocked');
          vaultStatusRef.current = 'unlocked';
        } else {
          setVaultStatus('locked');
          vaultStatusRef.current = 'locked';
        }
      } else {
        // Only set to setup if we don't have cached data
        if (!cachedUri) {
          setVaultStatus('setup');
          vaultStatusRef.current = 'setup';
        }
      }
    } catch (err) {
      console.error('Failed to fetch vault:', err);
      // Network error — don't nuke vault state if we have cached data
      if (cachedUri) {
        setDecryptedUri(cachedUri);
        try {
          const encodedPwd = sessionStorage.getItem('_vault_pwd');
          if (encodedPwd) masterPwdRef.current = atob(encodedPwd);
        } catch (_) {}
        const cachedTunnel = sessionStorage.getItem('_vault_tunnel');
        if (cachedTunnel) {
          try { setDecryptedTunnel(JSON.parse(cachedTunnel)); } catch (_) {}
        }
        setVaultStatus('unlocked');
        vaultStatusRef.current = 'unlocked';
      } else if (vaultData?.isConfigured) {
        setVaultStatus('locked');
        vaultStatusRef.current = 'locked';
      }
    }
  }, [vaultData]);

  /**
   * Unlock the vault with the Master Password.
   * Decrypts the URI client-side and keeps it in memory + sessionStorage.
   */
  const unlockVault = useCallback(async (masterPassword) => {
    if (!vaultData?.encryptedUri) {
      throw new Error('No vault data to decrypt');
    }

    setError('');

    try {
      // First verify the password hash
      const inputHash = await hashPassword(masterPassword, vaultData.salt);
      if (inputHash !== vaultData.passwordHash) {
        throw new Error('WRONG_PASSWORD');
      }

      // Decrypt the URI (or URI+tunnel JSON blob) client-side
      const decryptedBlob = await decryptWithPassword(
        vaultData.encryptedUri,
        vaultData.salt,
        vaultData.iv,
        masterPassword
      );

      // Support new format: JSON blob { uri, tunnel } or legacy plain URI string
      let uri = decryptedBlob;
      let tunnel = null;
      try {
        const parsed = JSON.parse(decryptedBlob);
        if (parsed && parsed.uri) {
          uri = parsed.uri;
          tunnel = parsed.tunnel || null;
        }
      } catch (_) {
        // Legacy plain URI — no tunnel
      }

      // Store in memory + sessionStorage (cleared on tab close)
      setDecryptedUri(uri);
      if (tunnel) {
        setDecryptedTunnel(tunnel);
        sessionStorage.setItem('_vault_tunnel', JSON.stringify(tunnel));
      } else {
        setDecryptedTunnel(null);
        sessionStorage.removeItem('_vault_tunnel');
      }
      sessionStorage.setItem('_vault_uri', uri);
      sessionStorage.setItem('_vault_pwd_ts', String(Date.now()));
      // Store encrypted password for sync operations (cleared on tab close)
      try {
        const encoded = btoa(masterPassword);
        sessionStorage.setItem('_vault_pwd', encoded);
      } catch (_) {}
      setVaultStatus('unlocked');
      vaultStatusRef.current = 'unlocked'; // Update ref immediately
      hasFetchedRef.current = true; // Mark as fetched to prevent re-fetch

      // Cache password in memory for sync operations (never persisted)
      masterPwdRef.current = masterPassword;

      return uri;
    } catch (err) {
      if (err.message === 'WRONG_PASSWORD') {
        setError('Incorrect Master Password');
        throw new Error('Incorrect Master Password');
      }
      setError('Decryption failed');
      throw err;
    }
  }, [vaultData]);

  /**
   * Set up the vault for the first time (or after recovery reset).
   * Encrypts the URI client-side and stores encrypted data.
   */
  const setupVault = useCallback(async (mongoUri, masterPassword, tunnelConfig = null) => {
    setError('');

    try {
      // Encode URI + tunnel config as a single JSON blob (backward compatible)
      const blob = tunnelConfig && tunnelConfig.enabled
        ? JSON.stringify({ uri: mongoUri, tunnel: tunnelConfig })
        : mongoUri;

      // 1. Encrypt client-side
      const { encrypted, salt, iv } = await encryptWithPassword(blob, masterPassword);
      
      // 2. Create password hash for future verification
      const pwHash = await hashPassword(masterPassword, salt);

      const vaultPayload = {
        encryptedUri: encrypted,
        salt,
        iv,
        passwordHash: pwHash,
        isConfigured: true,
      };

      if (session) {
        // 3a. Send encrypted data to server
        const res = await fetch('/api/user/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vaultPayload),
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to save vault');
        }
      } else {
        // 3b. Save to Local Storage for guests
        localStorage.setItem('ssh_monitor_local_vault', JSON.stringify(vaultPayload));
      }

      // 4. Keep decrypted URI + tunnel in memory for this session
      setDecryptedUri(mongoUri);
      sessionStorage.setItem('_vault_uri', mongoUri);
      if (tunnelConfig && tunnelConfig.enabled) {
        setDecryptedTunnel(tunnelConfig);
        sessionStorage.setItem('_vault_tunnel', JSON.stringify(tunnelConfig));
      } else {
        setDecryptedTunnel(null);
        sessionStorage.removeItem('_vault_tunnel');
      }
      setVaultData(vaultPayload);
      setVaultStatus('unlocked');
      vaultStatusRef.current = 'unlocked'; // Update ref immediately
      hasFetchedRef.current = true; // Mark as fetched to prevent re-fetch

      // Cache password in memory for sync operations (never persisted)
      masterPwdRef.current = masterPassword;

      // If vault already had data (password change/reset), old synced connections are now undecryptable
      if (session && vaultData?.isConfigured) {
        try {
          await fetch('/api/user/synced-connections', { 
            method: 'DELETE', 
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ clearAll: true }) });
        } catch (_) {}
        // Notify UI that password changed — synced connections need re-sync
        window.dispatchEvent(new CustomEvent('vault-password-changed'));
      }

      return true;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [session]);

  /**
   * Request a recovery code via email
   */
  const requestRecovery = useCallback(async () => {
    const res = await fetch('/api/user/vault/recovery', {
      method: 'POST',
    });
    return res.json();
  }, []);

  /**
   * Verify recovery code and reset the vault
   */
  const verifyRecovery = useCallback(async (code) => {
    const res = await fetch('/api/user/vault/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    
    if (data.success) {
      // Reset local state
      setDecryptedUri('');
      setVaultData(null);
      sessionStorage.removeItem('_vault_uri');
      setVaultStatus('setup');
    }

    return data;
  }, []);

  /**
   * Lock the vault (clear decrypted data from memory)
   */
  const lockVault = useCallback(() => {
    setDecryptedUri('');
    setDecryptedTunnel(null);
    sessionStorage.removeItem('_vault_uri');
    sessionStorage.removeItem('_vault_tunnel');
    masterPwdRef.current = null; // Clear cached sync key
    hasFetchedRef.current = false; // Allow re-fetch after unlock
    if (vaultData?.isConfigured) {
      setVaultStatus('locked');
    }
  }, [vaultData]);

  /**
   * Clear vault completely (disconnect)
   */
  const clearVault = useCallback(async () => {
    try {
      if (session) {
        await fetch('/api/user/vault', { method: 'DELETE' });
      } else {
        localStorage.removeItem('ssh_monitor_local_vault');
      }
      setDecryptedUri('');
      setVaultData(null);
      sessionStorage.removeItem('_vault_uri');
      masterPwdRef.current = null; // Clear cached sync key
      hasFetchedRef.current = false; // Allow re-fetch after setup
      setVaultStatus('setup');
    } catch (err) {
      console.error('Failed to clear vault:', err);
    }
  }, [session]);

  /**
   * Dismiss vault prompts for this session
   */
  const dismissVault = useCallback(() => {
    setIsDismissed(true);
  }, []);

  /**
   * Reshow vault prompts
   */
  const showVault = useCallback(() => {
    setIsDismissed(false);
  }, []);

  return (
    <VaultContext.Provider value={{
      vaultStatus,     // 'loading' | 'no_auth' | 'setup' | 'locked' | 'unlocked'
      decryptedUri,    // Plain URI (only in memory when unlocked)
      decryptedTunnel, // SSH tunnel config (only in memory when unlocked)
      error,           // Error message
      unlockVault,     // (masterPassword) => Promise<uri>
      setupVault,      // (mongoUri, masterPassword) => Promise<boolean>
      lockVault,       // () => void
      clearVault,      // () => Promise<void>
      verifyRecovery,  // (code) => Promise<response>
      requestRecovery, // () => Promise<response>
      fetchVault,      // () => refresh vault state
      hasLegacyUri,    // boolean
      legacyUri,       // string (if available)
      isDismissed,     // boolean
      dismissVault,    // () => void
      showVault,        // () => void
      isConfigured: vaultStatus !== 'setup' && vaultStatus !== 'loading',
      isUnlocked: vaultStatus === 'unlocked',
      getMasterPassword: () => masterPwdRef.current, // Returns cached password or null (memory only)
      verifyMasterPassword: async (password) => {
        if (!vaultData?.passwordHash || !vaultData?.salt) return false;
        const hash = await hashPassword(password, vaultData.salt);
        return hash === vaultData.passwordHash;
      }
    }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVault must be used within VaultProvider');
  }
  return context;
}
