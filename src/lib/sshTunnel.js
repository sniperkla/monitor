/**
 * Shared SSH Tunnel utility.
 * Used by both mongodb.js (Vault private DB) and dbPool.js (Connection Manager).
 *
 * Tunnels are pooled globally so the same SSH connection is reused
 * across multiple requests.
 */
import net from 'net';
import { Client as SshClient } from 'ssh2';
import { logger } from '@/lib/logger';

// Global tunnel pool — survives hot-reloads in dev
const tunnelPool = global.__sshTunnelPool || (global.__sshTunnelPool = new Map());

/**
 * Creates or reuses an SSH tunnel that forwards remoteHost:remotePort
 * to a random local port on 127.0.0.1.
 *
 * @param {object} config
 * @param {string}  config.sshHost        SSH server hostname
 * @param {number}  [config.sshPort=22]   SSH server port
 * @param {string}  config.sshUser        SSH username
 * @param {string}  [config.sshAuth]      'password' | 'privateKey'
 * @param {string}  [config.sshPassword]  Password (when sshAuth='password')
 * @param {string}  [config.sshPrivateKey] PEM private key (when sshAuth='privateKey')
 * @param {string}  [config.sshPassphrase] Private key passphrase
 * @param {string}  config.remoteHost     Remote host to forward to
 * @param {number}  config.remotePort     Remote port to forward to
 * @returns {Promise<number>} Local port number
 */
export async function createSSHTunnel({
  sshHost,
  sshPort = 22,
  sshUser,
  sshAuth = 'password',
  sshPassword,
  sshPrivateKey,
  sshPassphrase,
  remoteHost,
  remotePort,
}) {
  const tunnelKey = `ssh:${sshUser}@${sshHost}:${sshPort}->${remoteHost}:${remotePort}`;

  // Reuse existing healthy tunnel
  if (tunnelPool.has(tunnelKey)) {
    const existing = tunnelPool.get(tunnelKey);
    if (existing.server?.listening) {
      return existing.port;
    }
    // Stale entry — remove and recreate
    tunnelPool.delete(tunnelKey);
  }

  return new Promise((resolve, reject) => {
    const sshClient = new SshClient();

    sshClient.on('ready', () => {
      // Local TCP server proxies to remote via SSH forwarding
      const server = net.createServer((sock) => {
        sshClient.forwardOut(
          '127.0.0.1', 0,
          remoteHost, Number(remotePort),
          (err, stream) => {
            if (err) { sock.destroy(); return; }
            sock.pipe(stream);
            stream.pipe(sock);
            stream.on('close', () => sock.destroy());
            sock.on('close', () => stream.destroy());
          }
        );
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        tunnelPool.set(tunnelKey, { server, port, sshClient, tunnelKey });
        // Auto-clean on server close
        server.on('close', () => tunnelPool.delete(tunnelKey));
        resolve(port);
      });

      server.on('error', (err) => {
        sshClient.end();
        reject(err);
      });
    });

    sshClient.on('error', reject);

    const connectCfg = {
      host: sshHost,
      port: Number(sshPort) || 22,
      username: sshUser,
      readyTimeout: 15000,
    };

    if (sshAuth === 'privateKey' && sshPrivateKey) {
      connectCfg.privateKey = sshPrivateKey;
      if (sshPassphrase) connectCfg.passphrase = sshPassphrase;
    } else {
      connectCfg.password = sshPassword;
    }

    sshClient.connect(connectCfg);
  });
}

/**
 * Rewrites a database URI so it points to 127.0.0.1:localPort
 * (used after opening an SSH tunnel to a remote DB).
 *
 * @param {string} uri       Original database URI
 * @param {number} localPort Local port of the SSH tunnel
 * @returns {string}         Rewritten URI
 */
export function rewriteUriForTunnel(uri, localPort) {
  try {
    const url = new URL(uri);
    url.hostname = '127.0.0.1';
    url.port = String(localPort);
    return url.toString();
  } catch {
    return uri;
  }
}

/**
 * Parses a database URI and returns its host and port.
 * Falls back to defaults for MongoDB (27017) and MySQL (3306).
 */
export function parseUriHostPort(uri) {
  let remoteHost = 'localhost';
  let remotePort = uri.startsWith('mysql://') ? 3306 : (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) ? 5432 : 27017;
  try {
    const url = new URL(uri);
    remoteHost = url.hostname || 'localhost';
    remotePort = parseInt(url.port) || remotePort;
  } catch {}
  return { remoteHost, remotePort };
}

export function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1)$/i.test(String(host || '').trim());
}

/**
 * Find an active Local Relay for the given user.
 * Falls back to the only active relay when userId is unknown (single-user setups).
 */
export function findActiveRelay(userId, relayId) {
  if (!global.__activeRelays?.size) return null;

  if (userId && global.__activeRelays.has(userId)) {
    const userRelays = global.__activeRelays.get(userId);

    if (userRelays instanceof Map) {
      if (relayId && userRelays.has(relayId)) {
        return { relay: userRelays.get(relayId), userId, relayId };
      }
      if (userRelays.size > 0) {
        const [rid, relay] = userRelays.entries().next().value;
        return { relay, userId, relayId: rid };
      }
    } else {
      return { relay: userRelays, userId };
    }
  }

  if (global.__activeRelays.size === 1) {
    const [uid, userRelays] = global.__activeRelays.entries().next().value;
    if (userRelays instanceof Map) {
      if (userRelays.size > 0) {
        const [rid, relay] = userRelays.entries().next().value;
        return { relay, userId: uid, relayId: rid };
      }
    } else {
      return { relay: userRelays, userId: uid };
    }
  }

  return null;
}

/**
 * Set the relay agent's remote target. Never treat the relay proxy port as the DB port.
 */
export function applyRelayTarget(relay, host, port) {
  const parsedPort = parseInt(port, 10) || 27017;
  if (parsedPort === relay.localPort) {
    relay.targetHost = relay.targetHost || '127.0.0.1';
    if (!relay.targetPort || relay.targetPort === relay.localPort) {
      relay.targetPort = 27017;
    }
    return;
  }
  relay.targetHost = host || '127.0.0.1';
  relay.targetPort = parsedPort;
}

/**
 * If a URI was saved with a relay proxy port (e.g. :54309), restore the real DB port.
 */
export function normalizeRelayDatabaseUri(uri) {
  if (!uri || !/localhost|127\.0\.0\.1/.test(uri)) return uri;
  if (!global.__activeRelays?.size) return uri;

  try {
    const url = new URL(uri);
    const uriPort = parseInt(url.port, 10);
    if (!uriPort) return uri;

    for (const userRelays of global.__activeRelays.values()) {
      if (userRelays instanceof Map) {
        for (const relay of userRelays.values()) {
          if (uriPort === relay.localPort) {
            const restoredPort =
              relay.targetPort && relay.targetPort !== relay.localPort
                ? relay.targetPort
                : 27017;
            url.port = String(restoredPort);
            logger.info(
              `🔧 [Relay] Normalized URI port ${uriPort} → ${restoredPort} (relay proxy port)`
            );
            return url.toString();
          }
        }
      } else if (uriPort === userRelays.localPort) {
        const restoredPort =
          userRelays.targetPort && userRelays.targetPort !== userRelays.localPort
            ? userRelays.targetPort
            : 27017;
        url.port = String(restoredPort);
        logger.info(
          `🔧 [Relay] Normalized URI port ${uriPort} → ${restoredPort} (relay proxy port)`
        );
        return url.toString();
      }
    }
  } catch {}

  return uri;
}

/**
 * Route a localhost DB host/port through the user's relay agent when available.
 */
export function resolveLocalhostViaRelay(host, port, userId, relayId) {
  if (!isLocalHost(host)) return { host, port, usedRelay: false };

  const found = findActiveRelay(userId, relayId);
  if (!found?.relay?.localPort) {
    if (process.env.NODE_ENV === 'development') {
      logger.warn('⚠️ [Relay] No active relay — using server localhost (development only)');
      return { host, port, usedRelay: false };
    }
    throw new Error(
      'Local Relay Agent is not connected. Install and start local-relay.js on your machine, then retry.'
    );
  }

  applyRelayTarget(found.relay, host, port);
  logger.info(
    `🔗 Relay: routing ${found.relay.targetHost}:${found.relay.targetPort} → 127.0.0.1:${found.relay.localPort}` +
    (userId ? ` (user ${userId})` : ' (single active relay)')
  );
  return { host: '127.0.0.1', port: found.relay.localPort, usedRelay: true, relayId: found.relayId };
}
