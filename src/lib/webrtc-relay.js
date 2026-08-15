/**
 * webrtc-relay.js — Browser-side WebRTC relay peer
 *
 * Creates a direct P2P connection from the browser to the local relay agent
 * via WebRTC DataChannels. The Next.js server is used only for signaling
 * (SDP offer/answer + ICE candidates) and never for data.
 *
 * DataChannel layout:
 *   control  — JSON commands/events (ssh:start, sftp:cmd, file:*, ssh:connected, etc.)
 *   ssh      — raw SSH terminal I/O (muxed by connId prefix)
 *   sftp     — SFTP JSON commands + list responses
 *   file     — binary file transfer chunks (ArrayBuffer)
 *
 * Fallback: if ICE negotiation fails within ICE_TIMEOUT_MS, createRelayPeer()
 * rejects and the caller should fall back to WebSocket relay.
 */

'use client';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Time to wait for ICE connection before declaring fallback
const ICE_TIMEOUT_MS = 10_000;

// DataChannel names
export const DC = {
  CONTROL: 'control',
  SSH:     'ssh',
  SFTP:    'sftp',
  FILE:    'file',
};

/**
 * createRelayPeer({ socket, relayConnId })
 *
 * @param {Object} opts
 * @param {import('socket.io-client').Socket} opts.socket   — active Socket.io socket (signaling)
 * @param {string}  opts.relayConnId                        — relay connection ID (from server)
 * @returns {Promise<RelayPeer>}  resolves when all DataChannels are open
 *                                rejects on ICE timeout → caller should fallback to WS relay
 */
export async function createRelayPeer({ socket, relayConnId }) {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('WebRTC not supported in this environment');
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Create all DataChannels (ordered, reliable)
  const channels = {};
  for (const name of Object.values(DC)) {
    channels[name] = pc.createDataChannel(name, { ordered: true });
  }

  // ── ICE candidate trickle ─────────────────────────────────────────────────
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc:ice-candidate', { connId: relayConnId, candidate });
    }
  };

  // Handle ICE candidates coming FROM relay (via server signaling)
  const onRelayCandidate = ({ connId, candidate }) => {
    if (connId !== relayConnId) return;
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  };
  socket.on('webrtc:ice-candidate', onRelayCandidate);

  // Handle SDP answer from relay (via server signaling)
  const onAnswer = ({ connId, sdp }) => {
    if (connId !== relayConnId || !sdp || !sdp.type) return;
    try {
      pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch(err => {
        console.error('[WebRTC] setRemoteDescription error:', err);
      });
    } catch (e) {
      console.error('[WebRTC] Invalid RTCSessionDescription:', e);
    }
  };
  socket.on('webrtc:answer', onAnswer);

  // ── Create and send offer ─────────────────────────────────────────────────
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc:offer', { connId: relayConnId, sdp: pc.localDescription });

  // ── Wait for all DataChannels to open or timeout ──────────────────────────
  let peer;
  try {
    peer = await Promise.race([
      waitForChannels(pc, channels, relayConnId),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('WebRTC ICE timeout — falling back to WebSocket relay')),
          ICE_TIMEOUT_MS
        )
      ),
    ]);
  } finally {
    // Always remove signaling listeners
    socket.off('webrtc:ice-candidate', onRelayCandidate);
    socket.off('webrtc:answer', onAnswer);
  }

  return peer;
}

function waitForChannels(pc, channels, relayConnId) {
  return new Promise((resolve, reject) => {
    const channelNames = Object.values(DC);
    const opened = new Set();

    for (const [name, dc] of Object.entries(channels)) {
      dc.onopen = () => {
        opened.add(name);
        if (opened.size === channelNames.length) {
          resolve(buildPeer(pc, channels, relayConnId));
        }
      };
      dc.onerror = (err) => {
        reject(new Error(`DataChannel '${name}' error: ${err?.message || err}`));
      };
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        reject(new Error('WebRTC connection failed — falling back to WebSocket relay'));
      }
    };
  });
}

function buildPeer(pc, channels, relayConnId) {
  const controlListeners = new Set();

  channels[DC.CONTROL].onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      for (const handler of controlListeners) handler(msg);
    } catch {
      console.warn('[WebRTC] Non-JSON control message:', evt.data);
    }
  };

  const peer = {
    pc,
    relayConnId,

    /** Get a DataChannel by name */
    channel(name) { return channels[name]; },

    /**
     * Subscribe to control-plane messages (parsed JSON)
     * @returns {Function} unsubscribe
     */
    onControl(handler) {
      controlListeners.add(handler);
      return () => controlListeners.delete(handler);
    },

    /** Send JSON over the control channel */
    sendControl(msg) {
      const dc = channels[DC.CONTROL];
      if (dc.readyState === 'open') dc.send(JSON.stringify(msg));
    },

    /** Send raw SSH data (string or ArrayBuffer) */
    sendSsh(data) {
      const dc = channels[DC.SSH];
      if (dc.readyState === 'open') dc.send(data);
    },

    /** Send binary file chunk (ArrayBuffer or Uint8Array) */
    sendFile(data) {
      const dc = channels[DC.FILE];
      if (dc.readyState !== 'open') return;
      dc.send(data instanceof Uint8Array ? data.buffer : data);
    },

    /** True if file channel can accept more data without exceeding 16 MB buffer */
    canSendFile() {
      const dc = channels[DC.FILE];
      return dc.readyState === 'open' && dc.bufferedAmount < 16 * 1024 * 1024;
    },

    /** Wait until file channel buffer drains below 4 MB */
    waitForFileDrain() {
      const dc = channels[DC.FILE];
      if (this.canSendFile()) return Promise.resolve();
      return new Promise(resolve => {
        dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;
        dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; resolve(); };
      });
    },

    /** Close all channels and peer connection */
    close() {
      for (const dc of Object.values(channels)) { try { dc.close(); } catch {} }
      try { pc.close(); } catch {}
      controlListeners.clear();
    },
  };

  return peer;
}

// ── Streaming helpers ─────────────────────────────────────────────────────────

/**
 * streamUpload — stream a File/Blob to the relay via the file DataChannel
 *
 * @param {Object}   peer        — RelayPeer from createRelayPeer()
 * @param {string}   connId      — SSH/SFTP session connection ID
 * @param {File}     file        — file to upload
 * @param {string}   destPath    — destination path on remote
 * @param {Object}   [opts]
 * @param {number}   [opts.startOffset=0]      — resume from byte offset
 * @param {number}   [opts.chunkSize=524288]   — initial chunk size (512 KB)
 * @param {Function} [opts.onProgress]         — (bytesUploaded, totalBytes) => void
 * @param {AbortSignal} [opts.signal]          — cancellation
 * @returns {Promise<{sha256: string}>}
 */
export async function streamUpload(peer, connId, file, destPath, {
  startOffset = 0,
  chunkSize = 512 * 1024,
  onProgress,
  signal,
} = {}) {
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

  // Tell relay to open write stream
  peer.sendControl({
    type: 'file:upload:start',
    connId,
    filename: file.name,
    destPath,
    size: file.size,
    offset: startOffset,
  });

  // Wait for relay ready / error
  await new Promise((resolve, reject) => {
    const unsub = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:upload:ready') { unsub(); resolve(); }
      if (msg.type === 'file:upload:error') { unsub(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsub(); reject(new DOMException('Upload cancelled', 'AbortError')); });
  });

  // Stream file using ReadableStream
  const stream = file.slice(startOffset).stream ? file.slice(startOffset).stream() : null;
  const reader = stream?.getReader();

  let offset = startOffset;
  let carry = new Uint8Array(0);
  let t0 = performance.now();

  const readNext = async () => {
    if (!reader) return null;
    const { done, value } = await reader.read();
    return done ? null : value;
  };

  let chunk = await readNext();
  while (chunk !== null || carry.length > 0) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

    // Merge carry + new chunk
    if (chunk) {
      const merged = new Uint8Array(carry.length + chunk.length);
      merged.set(carry);
      merged.set(chunk, carry.length);
      carry = merged;
    }

    // Send full chunks from carry
    while (carry.length >= chunkSize || (chunk === null && carry.length > 0)) {
      const toSend = carry.slice(0, chunkSize);
      carry = carry.slice(chunkSize);

      if (!peer.canSendFile()) await peer.waitForFileDrain();

      peer.sendFile(toSend.buffer);
      offset += toSend.length;
      onProgress?.(offset, file.size);

      // Adaptive chunk sizing
      const elapsed = performance.now() - t0;
      if (elapsed < 100 && chunkSize < 1024 * 1024) chunkSize = Math.min(chunkSize * 2, 1024 * 1024);
      else if (elapsed > 500 && chunkSize > 64 * 1024) chunkSize = Math.max(chunkSize / 2, 64 * 1024);
      t0 = performance.now();
    }

    if (chunk === null) break;
    chunk = await readNext();
  }

  // Signal upload complete to relay
  peer.sendControl({ type: 'file:upload:done', connId, filename: file.name, destPath });

  // Wait for relay to confirm + sha256
  return new Promise((resolve, reject) => {
    const unsub = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:upload:complete') { unsub(); resolve({ sha256: msg.sha256 }); }
      if (msg.type === 'file:upload:error')    { unsub(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsub(); reject(new DOMException('Upload cancelled', 'AbortError')); });
  });
}

/**
 * streamDownload — receive a file from the relay via the file DataChannel
 *
 * @param {Object}   peer
 * @param {string}   connId
 * @param {string}   remotePath
 * @param {Object}   [opts]
 * @param {Function} [opts.onProgress]  — (received, total) => void
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{blob: Blob, sha256: string, filename: string}>}
 */
export async function streamDownload(peer, connId, remotePath, {
  onProgress,
  signal,
} = {}) {
  peer.sendControl({ type: 'file:download:start', connId, path: remotePath });

  // Get file metadata
  const { size, filename } = await new Promise((resolve, reject) => {
    const unsub = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:download:meta')  { unsub(); resolve(msg); }
      if (msg.type === 'file:download:error') { unsub(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsub(); reject(new DOMException('Download cancelled', 'AbortError')); });
  });

  // Receive binary chunks from file DataChannel + done signal on control
  const dc = peer.channel(DC.FILE);
  const chunks = [];
  let received = 0;
  const prevHandler = dc.onmessage;

  const result = await new Promise((resolve, reject) => {
    dc.onmessage = (evt) => {
      if (signal?.aborted) { reject(new DOMException('Download cancelled', 'AbortError')); return; }
      const chunk = new Uint8Array(evt.data instanceof ArrayBuffer ? evt.data : new Uint8Array(evt.data));
      chunks.push(chunk);
      received += chunk.length;
      onProgress?.(received, size);
    };

    const unsub = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:download:done') {
        unsub(); dc.onmessage = prevHandler;
        resolve({ sha256: msg.sha256, filename: filename || remotePath.split('/').pop() });
      }
      if (msg.type === 'file:download:error') {
        unsub(); dc.onmessage = prevHandler;
        reject(new Error(msg.error));
      }
    });
    signal?.addEventListener('abort', () => { unsub(); dc.onmessage = prevHandler; reject(new DOMException('Download cancelled', 'AbortError')); });
  });

  const blob = new Blob(chunks);
  return { blob, ...result };
}
