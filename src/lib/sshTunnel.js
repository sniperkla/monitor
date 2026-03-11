/**
 * Shared SSH Tunnel utility.
 * Used by both mongodb.js (Vault private DB) and dbPool.js (Connection Manager).
 *
 * Tunnels are pooled globally so the same SSH connection is reused
 * across multiple requests.
 */
import net from 'net';
import { Client as SshClient } from 'ssh2';

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
