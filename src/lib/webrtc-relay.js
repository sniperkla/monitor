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

    /** Send binary file chunk (ArrayBuffer or Uint8Array).
     *  Returns false if the channel is closed or the send queue is full. */
    sendFile(data) {
      const dc = channels[DC.FILE];
      if (dc.readyState !== 'open') return false;
      try {
        // Pass ArrayBufferView (Uint8Array subarray) directly — dc.send() respects
        // byteOffset + byteLength so only the intended slice is transmitted.
        // Do NOT unwrap to .buffer — that would send the entire backing ArrayBuffer.
        dc.send(data);
        return true;
      } catch (e) {
        // RTCDataChannel throws if send queue is full or channel is closing
        console.warn('[WebRTC] sendFile failed:', e?.message);
        return false;
      }
    },

    /** True if the file channel buffer is low enough to send another chunk safely.
     *  Allow up to 4 MB in the buffer — enough to keep the pipeline full
     *  while staying well below the browser's 16 MB hard limit. */
    canSendFile() {
      const dc = channels[DC.FILE];
      return dc.readyState === 'open' && dc.bufferedAmount < 4 * 1024 * 1024;
    },

    /** Wait until the file channel buffer drains below 512 KB.
     *  This keeps multiple chunks in flight (pipelined) for maximum throughput. */
    waitForFileDrain() {
      const dc = channels[DC.FILE];
      if (this.canSendFile()) return Promise.resolve();
      if (dc.readyState !== 'open') return Promise.resolve();
      return new Promise(resolve => {
        const DRAIN_TARGET = 512 * 1024;
        dc.bufferedAmountLowThreshold = DRAIN_TARGET;
        const onLow = () => { dc.onbufferedamountlow = null; clearInterval(poll); resolve(); };
        dc.onbufferedamountlow = onLow;
        // Fallback poll in case bufferedAmountLow never fires (some implementations)
        const poll = setInterval(() => {
          if (dc.readyState !== 'open' || dc.bufferedAmount <= DRAIN_TARGET) {
            clearInterval(poll);
            dc.onbufferedamountlow = null;
            resolve();
          }
        }, 10);
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
 * @param {number}   [opts.chunkSize=262144]   — chunk size (default 256 KB, max per RTCDataChannel spec)
 * @param {Function} [opts.onProgress]         — (bytesUploaded, totalBytes) => void
 * @param {AbortSignal} [opts.signal]          — cancellation
 * @returns {Promise<{sha256: string}>}
 */
// RTCDataChannel max-message-size: Chromium allows up to 256 KB per message.
// We use 64 KB chunks for maximum compatibility across all browsers.
// Some browsers have DataChannel message size limits around 64-256 KB.
const WEBRTC_MAX_CHUNK = 64 * 1024;

export async function streamUpload(peer, connId, file, destPath, {
  startOffset = 0,
  chunkSize = 64 * 1024,  // 64 KB — safe across all browsers
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

  // Overlap: start reading the file into memory NOW while we wait for relay:
  // The relay:ready RTT (control channel) is ~1-5ms on LAN.
  // file.arrayBuffer() on 80MB takes ~50-200ms. Running both in parallel hides the read cost.
  // For files >1GB, use streaming mode to avoid OOM (out of memory).
  const USE_STREAMING_THRESHOLD = 1024 * 1024 * 1024;  // 1GB threshold
  const fileReadPromise = file.size <= USE_STREAMING_THRESHOLD
    ? file.arrayBuffer().then(ab => new Uint8Array(ab))
    : Promise.resolve(null);

  // Wait for relay ready / error (runs concurrently with file read above)
  await new Promise((resolve, reject) => {
    const unsub = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:upload:ready') { unsub(); resolve(); }
      if (msg.type === 'file:upload:error') { unsub(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsub(); reject(new DOMException('Upload cancelled', 'AbortError')); });
  });

  // Register progress + completion listeners BEFORE sending any data.
  // Progress strategy:
  //   - Client send offset gives real-time feedback as chunks leave the browser (fast, responsive)
  //   - Relay file:upload:progress can correct the value upward as SFTP writes confirm
  //   - file:upload:complete is the only event that triggers 100%
  //   - Neither source alone is sufficient: client is too fast (hits 100% before relay writes),
  //     relay is too slow (messages arrive in batches after the send loop finishes)
  let unsubProgress;
  let relayHighWater = startOffset; // highest byte count confirmed by relay
  const progressPromise = new Promise((resolve, reject) => {
    unsubProgress = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:upload:progress') {
        relayHighWater = Math.max(relayHighWater, msg.received ?? 0);
        // Show relay progress if it's ahead of what we last reported, capped at 99%
        const capped = Math.min(relayHighWater, file.size - 1);
        onProgress?.(capped, file.size);
        return;
      }
      if (msg.type === 'file:upload:complete') {
        onProgress?.(file.size, file.size); // 100% only on confirmed complete
        unsubProgress();
        resolve({ sha256: msg.sha256 });
      }
      if (msg.type === 'file:upload:error') { unsubProgress(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsubProgress?.(); reject(new DOMException('Upload cancelled', 'AbortError')); });
  });

  // Pre-read entire file into a Uint8Array once — eliminates per-chunk async yields
  // and allows zero-copy slicing via subarray() instead of ArrayBuffer.slice() copies.
  // For files >1GB fall back to streaming to avoid OOM.
  // fileReadPromise was already started above (overlapped with relay ready wait)
  let fileView = null; // Uint8Array over the full file buffer

  // Await file read — may already be done if relay RTT > file read time
  fileView = await fileReadPromise;

  console.log(`[WebRTC Upload] File: ${file.name}, Size: ${file.size} bytes, fileView: ${fileView ? fileView.length : 'null'} bytes, mode: ${fileView ? 'preloaded' : 'streaming'}`);

  let offset = startOffset;
  let lastProgressMs = 0;
  const fileDc = peer.channel(DC.FILE);

  try {
    let chunkCount = 0;
    while (offset < file.size) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

      if (!fileDc || fileDc.readyState !== 'open') {
        console.error(`[WebRTC Upload] DataChannel closed at offset ${offset}/${file.size}`);
        throw new Error('RTCDataChannel closed during upload');
      }

      // Block only when the send buffer is actually full
      if (!peer.canSendFile()) {
        await peer.waitForFileDrain();
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      }

      const end = Math.min(offset + chunkSize, file.size);
      chunkCount++;

      // Zero-copy subarray view (no memory allocation) vs slice() which copies
      // Zero-copy: Uint8Array.subarray() is a view into the same memory, no allocation
      // RTCDataChannel.send() accepts ArrayBufferView directly
      const buf = fileView
        ? fileView.subarray(offset, end)
        : await file.slice(offset, end).arrayBuffer();

      console.log(`[WebRTC Upload] Chunk ${chunkCount}: offset=${offset}, end=${end}, bufSize=${buf.byteLength || buf.length}, fileSize=${file.size}`);

      if (!peer.sendFile(buf)) {
        await peer.waitForFileDrain();
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
        if (!peer.sendFile(buf)) {
          throw new Error('RTCDataChannel send failed — queue full or channel closed');
        }
      }

      offset = end;

      console.log(`[WebRTC Upload] Progress: ${offset}/${file.size} (${(offset/file.size*100).toFixed(1)}%)`);

      // Add small pacing for ALL files to prevent overwhelming the receiver
      // This ensures reliable delivery even for small files
      await new Promise(resolve => setTimeout(resolve, 5));

      // Client-side progress: 10fps, capped at 95%
      const now = performance.now();
      if (now - lastProgressMs >= 100) {
        lastProgressMs = now;
        const clientCapped = Math.min(offset, Math.floor(file.size * 0.95));
        if (clientCapped > relayHighWater) onProgress?.(clientCapped, file.size);
      }
    }
    console.log(`[WebRTC Upload] Complete: ${file.name}, ${chunkCount} chunks, ${offset} bytes`);
    
    // Verify upload completeness
    if (offset !== file.size) {
      console.error(`❌ [WebRTC Upload] SIZE MISMATCH: sent ${offset} bytes but file is ${file.size} bytes!`);
      throw new Error(`Upload incomplete: sent ${offset}/${file.size} bytes`);
    }
  } catch (err) {
    console.error(`[WebRTC Upload] Error at offset ${offset}/${file.size}:`, err);
    unsubProgress?.();
    throw err;
  }

  // All chunks sent — tell relay to flush and close the SFTP write stream
  peer.sendControl({ type: 'file:upload:done', connId, filename: file.name, destPath });

  // Wait for relay to confirm — progress messages continue to update UI during SFTP flush
  return progressPromise;
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
