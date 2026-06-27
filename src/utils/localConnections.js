import { encryptWithPassword, decryptWithPassword } from './clientCrypto';

const getMasterPassword = () => {
  if (typeof window === 'undefined') return null;
  try {
    const encoded = sessionStorage.getItem('_vault_pwd');
    return encoded ? atob(encoded) : null;
  } catch (_) {
    return null;
  }
};

const getVaultStatus = () => {
  if (typeof window === 'undefined') return 'no_auth';
  const hasLocalVault = localStorage.getItem('ssh_monitor_local_vault');
  const hasSessionVault = sessionStorage.getItem('_vault_uri');
  if (hasSessionVault) return 'unlocked';
  if (hasLocalVault) return 'locked';
  return 'no_auth';
};

export async function getLocalConnections() {
  if (typeof window === 'undefined') return [];
  
  const savedEncrypted = localStorage.getItem('ssh_monitor_connections_encrypted');
  const savedPlain = localStorage.getItem('ssh_monitor_connections');
  const masterPwd = getMasterPassword();
  
  if (savedEncrypted) {
    if (!masterPwd) {
      // Vault is locked - do NOT return connections (keep them safely locked/hidden)
      return null;
    }
    try {
      const parsed = JSON.parse(savedEncrypted);
      const decrypted = await decryptWithPassword(parsed.encrypted, parsed.salt, parsed.iv, masterPwd);
      return JSON.parse(decrypted);
    } catch (e) {
      console.error('Failed to decrypt local connections:', e);
      return [];
    }
  }
  
  if (savedPlain) {
    try {
      const connections = JSON.parse(savedPlain);
      // Auto-migrate to encrypted storage if vault is unlocked
      if (masterPwd && connections.length > 0) {
        await saveLocalConnections(connections);
      }
      return connections;
    } catch (e) {
      console.error('Failed to parse plain local connections:', e);
      return [];
    }
  }
  
  return [];
}

export async function saveLocalConnections(connections) {
  if (typeof window === 'undefined') return;
  
  const masterPwd = getMasterPassword();
  const status = getVaultStatus();
  
  if (masterPwd) {
    try {
      const encrypted = await encryptWithPassword(JSON.stringify(connections), masterPwd);
      localStorage.setItem('ssh_monitor_connections_encrypted', JSON.stringify(encrypted));
      localStorage.removeItem('ssh_monitor_connections'); // Clean up plain text
    } catch (e) {
      console.error('Failed to encrypt and save local connections:', e);
    }
  } else {
    // If vault is not configured (no_auth), store as plain text
    if (status === 'no_auth') {
      localStorage.setItem('ssh_monitor_connections', JSON.stringify(connections));
      localStorage.removeItem('ssh_monitor_connections_encrypted');
    } else {
      console.warn('Cannot save local connections: Vault is locked.');
    }
  }
}
