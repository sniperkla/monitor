import { logger } from '@/lib/logger';
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
        logger.error('[WebRTC] setRemoteDescription error:', err);
      });
    } catch (e) {
      logger.error('[WebRTC] Invalid RTCSessionDescription:', e);
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
      logger.warn('[WebRTC] Non-JSON control message:', evt.data);
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
        logger.warn('[WebRTC] sendFile failed:', e?.message);
        return false;
      }
    },

    /** True if the file channel buffer is low enough to send another chunk safely.
     *  Keep 512 KB in the buffer — fast enough for 60+ MB/s LAN/WAN throughput
     *  while preventing Chromium SCTP buffer overflow and channel disconnection. */
    canSendFile() {
      const dc = channels[DC.FILE];
      return dc && dc.readyState === 'open' && dc.bufferedAmount < 512 * 1024;
    },

    /** Wait until the file channel buffer drains below 128 KB. */
    waitForFileDrain() {
      const dc = channels[DC.FILE];
      if (!dc || dc.readyState !== 'open') return Promise.resolve();
      if (dc.bufferedAmount < 128 * 1024) return Promise.resolve();
      return new Promise(resolve => {
        const DRAIN_TARGET = 128 * 1024;
        let doneCalled = false;
        let pollTimer = null;

        const done = () => {
          if (doneCalled) return;
          doneCalled = true;
          if (pollTimer) clearInterval(pollTimer);
          dc.onbufferedamountlow = null;
          resolve();
        };

        dc.bufferedAmountLowThreshold = DRAIN_TARGET;
        dc.onbufferedamountlow = done;

        // Safety fallback poll in case onbufferedamountlow is dropped
        pollTimer = setInterval(() => {
          if (!dc || dc.readyState !== 'open' || dc.bufferedAmount <= DRAIN_TARGET) {
            done();
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

export function getTarHeaderBlocks(pathName, fileSize, mtimeMs = Date.now()) {
  const enc = new TextEncoder();
  const blocks = [];
  const cleanPath = pathName.replace(/\\/g, '/').replace(/^\/+/, '');
  let ustarName = cleanPath;
  let ustarPrefix = '';

  const nameBytes = enc.encode(cleanPath);
  if (nameBytes.length > 100) {
    const slashIdx = cleanPath.lastIndexOf('/', 155);
    if (slashIdx > 0 && enc.encode(cleanPath.slice(slashIdx + 1)).length <= 100 && enc.encode(cleanPath.slice(0, slashIdx)).length <= 155) {
      ustarPrefix = cleanPath.slice(0, slashIdx);
      ustarName = cleanPath.slice(slashIdx + 1);
    } else {
      // GNU LongLink entry
      const longHeader = new Uint8Array(512);
      longHeader.set(enc.encode('././@LongLink\0'), 0);
      longHeader.set(enc.encode('0000644\0'), 100);
      longHeader.set(enc.encode('0000000\0'), 108);
      longHeader.set(enc.encode('0000000\0'), 116);
      longHeader.set(enc.encode(nameBytes.length.toString(8).padStart(11, '0') + ' '), 124);
      longHeader.set(enc.encode('00000000000 '), 136);
      longHeader[156] = 76; // 'L' flag for GNU LongLink
      longHeader.set(enc.encode('ustar  \0'), 257);
      for (let i = 0; i < 8; i++) longHeader[148 + i] = 32;
      let lchk = 0;
      for (let i = 0; i < 512; i++) lchk += longHeader[i];
      longHeader.set(enc.encode(lchk.toString(8).padStart(6, '0') + '\0 '), 148);

      blocks.push(longHeader);
      blocks.push(nameBytes);
      const lpad = (512 - (nameBytes.length % 512)) % 512;
      if (lpad > 0) blocks.push(new Uint8Array(lpad));

      ustarName = cleanPath.slice(0, 100);
      ustarPrefix = '';
    }
  }

  const header = new Uint8Array(512);
  header.set(enc.encode(ustarName).subarray(0, 100), 0);
  header.set(enc.encode('0000644\0'), 100);
  header.set(enc.encode('0000000\0'), 108);
  header.set(enc.encode('0000000\0'), 116);
  header.set(enc.encode(fileSize.toString(8).padStart(11, '0') + ' '), 124);
  header.set(enc.encode(Math.floor(mtimeMs / 1000).toString(8).padStart(11, '0') + ' '), 136);
  header[156] = 48; // '0' for normal file
  header.set(enc.encode('ustar\0'), 257);
  header.set(enc.encode('00'), 263);
  if (ustarPrefix) header.set(enc.encode(ustarPrefix).subarray(0, 155), 345);

  for (let i = 0; i < 8; i++) header[148 + i] = 32;
  let chk = 0;
  for (let i = 0; i < 512; i++) chk += header[i];
  header.set(enc.encode(chk.toString(8).padStart(6, '0') + '\0 '), 148);

  blocks.push(header);
  return blocks;
}

export function calculateTarTotalSize(entries) {
  const enc = new TextEncoder();
  let total = 0;
  for (const { file, size: entrySize, relativePath } of entries) {
    const fileSize = entrySize ?? file?.size ?? 0;
    const cleanPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = enc.encode(cleanPath);
    if (nameBytes.length > 100) {
      const slashIdx = cleanPath.lastIndexOf('/', 155);
      if (!(slashIdx > 0 && enc.encode(cleanPath.slice(slashIdx + 1)).length <= 100 && enc.encode(cleanPath.slice(0, slashIdx)).length <= 155)) {
        total += 512; // LongLink header
        total += nameBytes.length;
        const lpad = (512 - (nameBytes.length % 512)) % 512;
        if (lpad > 0) total += lpad;
      }
    }
    total += 512; // Header
    total += fileSize; // File data
    const pad = (512 - (fileSize % 512)) % 512;
    if (pad > 0) total += pad;
  }
  total += 1024; // End padding
  return total;
}

/**
 * streamTarUpload — streams a folder directly as an uncompressed TAR stream without creating Blobs.
 * Slices individual files directly (O(1) seek, zero memory consumption, zero CPU spikes).
 */
export async function streamTarUpload(peer, connId, entries, destPath, archiveFilename, {
  onProgress,
  signal,
} = {}) {
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

  const totalTarSize = calculateTarTotalSize(entries);
  logger.info(`[WebRTC Tar Upload] Starting on-the-fly TAR stream for "${archiveFilename}": ${entries.length} files, ${totalTarSize} bytes`);

  // Tell relay to open write stream for the tar archive
  peer.sendControl({
    type: 'file:upload:start',
    connId,
    filename: archiveFilename,
    destPath,
    size: totalTarSize,
    offset: 0,
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

  let unsubProgress;
  const progressPromise = new Promise((resolve, reject) => {
    unsubProgress = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:upload:complete') {
        onProgress?.(totalTarSize, totalTarSize);
        unsubProgress();
        resolve({ sha256: msg.sha256 });
      }
      if (msg.type === 'file:upload:error') { unsubProgress(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsubProgress?.(); reject(new DOMException('Upload cancelled', 'AbortError')); });
  });

  const CHUNK_SIZE = 64 * 1024;
  let sentBytes = 0;
  let lastProgressMs = 0;

  // ── 64KB Coalescing Buffer ────────────────────────────────────────────────
  // Coalesces thousands of 512-byte headers and small file slices into 64KB
  // WebRTC packets. Reduces 150,000+ micro-sends down to ~4,700 clean 64KB sends,
  // preventing Chromium SCTP queue exhaustion on folders with 50k+ files.
  const buffer = new Uint8Array(CHUNK_SIZE);
  let bufferOffset = 0;

  const flushBuffer = async () => {
    if (bufferOffset === 0) return;
    const chunkToSend = buffer.subarray(0, bufferOffset);
    bufferOffset = 0;
    await sendChunkSafe(chunkToSend);
  };

  const writeToBuffer = async (data) => {
    let dataOffset = 0;
    while (dataOffset < data.length) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      const available = CHUNK_SIZE - bufferOffset;
      const toCopy = Math.min(available, data.length - dataOffset);
      buffer.set(data.subarray(dataOffset, dataOffset + toCopy), bufferOffset);
      bufferOffset += toCopy;
      dataOffset += toCopy;
      if (bufferOffset === CHUNK_SIZE) {
        await flushBuffer();
      }
    }
  };

  const sendChunkSafe = async (buf) => {
    let attempts = 0;
    while (attempts < 80) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      const dc = peer.channel('file');
      if (dc && dc.readyState !== 'open') {
        throw new Error(`RTCDataChannel closed (state: ${dc.readyState})`);
      }
      if (!peer.canSendFile()) {
        await peer.waitForFileDrain();
      }
      if (peer.sendFile(buf)) {
        sentBytes += buf.length;
        // Dynamic CPU pacing yield — minimum 1ms yield to ensure SCTP packet delivery
        const delay = Math.max(1, getPacingDelayMs());
        await new Promise(r => setTimeout(r, delay));
        
        const now = performance.now();
        if (now - lastProgressMs >= 250) {
          lastProgressMs = now;
          const clientCapped = Math.min(sentBytes, Math.floor(totalTarSize * 0.95));
          onProgress?.(clientCapped, totalTarSize);
        }
        return;
      }
      attempts++;
      await peer.waitForFileDrain();
      await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('RTCDataChannel send failed — send buffer exhausted or channel closed');
  };

  try {
    let fileIdx = 0;
    for (const { file: storedFile, entry, relativePath, size: entrySize, lastModified: entryLastModified } of entries) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      fileIdx++;

      // Use metadata stored at scan time for the TAR header (avoids reading File prematurely)
      const fileSize = entrySize ?? storedFile?.size ?? 0;
      const fileLastModified = entryLastModified ?? storedFile?.lastModified ?? Date.now();

      // 1. Write TAR header blocks into coalescing buffer
      const headerBlocks = getTarHeaderBlocks(relativePath, fileSize, fileLastModified);
      for (const h of headerBlocks) {
        await writeToBuffer(h);
      }

      // 2. Stream individual file in 64KB slices into coalescing buffer
      let file = storedFile;
      if (!file && entry) {
        file = await new Promise((res, rej) => entry.file(res, rej));
      }

      let fileOffset = 0;
      while (fileOffset < fileSize) {
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
        const sliceEnd = Math.min(fileOffset + CHUNK_SIZE, fileSize);
        let sliceBuf;
        try {
          sliceBuf = await file.slice(fileOffset, sliceEnd).arrayBuffer();
        } catch (readErr) {
          if (entry && readErr.name === 'NotReadableError') {
            logger.warn(`[WebRTC Tar Upload] NotReadableError at offset ${fileOffset} for "${relativePath}" — re-fetching handle`);
            file = await new Promise((res, rej) => entry.file(res, rej));
            sliceBuf = await file.slice(fileOffset, sliceEnd).arrayBuffer();
          } else {
            throw readErr;
          }
        }
        await writeToBuffer(new Uint8Array(sliceBuf));
        fileOffset = sliceEnd;
      }

      // 3. Padding to 512-byte boundary
      const padLen = (512 - (fileSize % 512)) % 512;
      if (padLen > 0) {
        await writeToBuffer(new Uint8Array(padLen));
      }

      // Dynamic CPU pacing on file iteration loop to prevent Chromium filesystem IPC from pegging CPU
      if (fileIdx % 5 === 0) {
        const mode = typeof window !== 'undefined' ? (window.__uploadCpuMode || localStorage.getItem('ssh_monitor_upload_cpu_mode') || 'balanced') : 'balanced';
        if (mode === 'eco') {
          await new Promise(r => setTimeout(r, 15));
        } else if (mode === 'balanced') {
          await new Promise(r => setTimeout(r, 2));
        } else {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    // 4. Send final 1024-byte EOF null padding and flush remaining buffer
    await writeToBuffer(new Uint8Array(1024));
    await flushBuffer();

    logger.info(`[WebRTC Tar Upload] Sent all entries: ${archiveFilename}, total ${sentBytes}/${totalTarSize} bytes`);
    
    // Notify UI that all bytes are transmitted and server is finalizing write stream
    onProgress?.(totalTarSize, totalTarSize, { finalizing: true, status: 'Finalizing upload & writing to server disk...' });
  } catch (err) {
    logger.error(`[WebRTC Tar Upload] Error:`, err);
    unsubProgress?.();
    throw err;
  }

  // All chunks sent — tell relay to flush and close the SFTP write stream
  peer.sendControl({ type: 'file:upload:done', connId, filename: archiveFilename, destPath });

  return progressPromise;
}

/**
 * Dynamic CPU Throttle Pacing Delay
 * Reads the active user preference from window / localStorage.
 * - 'eco':      20ms per chunk (ultra-low CPU ~5%, temps ~38-42°C, silent fan)
 * - 'balanced': 3ms per chunk (low CPU ~15-20%, temps ~50°C, fast ~25MB/s)
 * - 'turbo':    1ms per chunk (ultra-fast ~45-60MB/s, rock-solid SCTP stability)
 */
export function getPacingDelayMs() {
  if (typeof window === 'undefined') return 3;
  // Hidden browser tabs clamp setTimeout heavily. During an active upload that
  // turns small pacing delays into multi-second stalls, so rely on transport
  // backpressure instead of timer sleeps while the tab is backgrounded.
  if (document.visibilityState === 'hidden' && window.__sshMonitorActiveUploadCount > 0) return 0;
  const mode = window.__uploadCpuMode || localStorage.getItem('ssh_monitor_upload_cpu_mode') || 'balanced';
  switch (mode) {
    case 'eco':      return 20;
    case 'balanced': return 3;
    case 'turbo':    return 1;
    default:         return 3;
  }
}

/**
 * streamUpload — stream a File/Blob to the relay via the file DataChannel
 *
 * @param {Object}   peer        — RelayPeer from createRelayPeer()
 * @param {string}   connId      — SSH/SFTP session connection ID
 * @param {File}     file        — file to upload
 * @param {string}   destPath    — destination path on remote
 * @param {Object}   [opts]
 * @param {number}   [opts.startOffset=0]      — resume from byte offset
 * @param {number}   [opts.chunkSize=65536]    — chunk size
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

  // For small files (<= 4MB), preloading is safe.
  // For any larger files, stream slices on-demand to guarantee <1MB RAM usage and eliminate OOM crashes.
  const PRELOAD_MAX_SIZE = 4 * 1024 * 1024;
  const fileReadPromise = file.size <= PRELOAD_MAX_SIZE
    ? file.arrayBuffer().then(ab => new Uint8Array(ab)).catch(() => null)
    : Promise.resolve(null);

  // Wait for relay ready / error (runs concurrently with small-file read above)
  await new Promise((resolve, reject) => {
    const unsub = peer.onControl((msg) => {
      if (msg.connId !== connId) return;
      if (msg.type === 'file:upload:ready') { unsub(); resolve(); }
      if (msg.type === 'file:upload:error') { unsub(); reject(new Error(msg.error)); }
    });
    signal?.addEventListener('abort', () => { unsub(); reject(new DOMException('Upload cancelled', 'AbortError')); });
  });

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

  const fileView = await fileReadPromise;
  logger.info(`[WebRTC Upload] Start: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB, mode: ${fileView ? 'preloaded' : 'streaming'})`);

  let offset = startOffset;
  let lastProgressMs = 0;
  const fileDc = peer.channel(DC.FILE);

  try {
    let chunkCount = 0;
    while (offset < file.size) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

      if (!fileDc || fileDc.readyState !== 'open') {
        logger.error(`[WebRTC Upload] DataChannel closed at offset ${offset}/${file.size}`);
        throw new Error('RTCDataChannel closed during upload');
      }

      // Backpressure: if SCTP send buffer exceeds 1 MB, pause until it drains below 256 KB
      if (!peer.canSendFile()) {
        await peer.waitForFileDrain();
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      }

      const end = Math.min(offset + chunkSize, file.size);
      chunkCount++;

      // Slice on-demand: garbage collected immediately, zero memory accumulation
      const sliceBlob = file.slice(offset, end);
      const arrayBuf = await sliceBlob.arrayBuffer();
      const buf = new Uint8Array(arrayBuf);

      if (!peer.sendFile(buf)) {
        await peer.waitForFileDrain();
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
        if (!peer.sendFile(buf)) {
          throw new Error('RTCDataChannel send failed — queue full or channel closed');
        }
      }

      offset = end;

      // Dynamic CPU Pacing yield
      const delay = getPacingDelayMs();
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (chunkCount % 4 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Throttled debug progress logging
      if (chunkCount % 500 === 0 || offset === file.size) {
        logger.info(`[WebRTC Upload] Progress: ${file.name} - ${offset}/${file.size} (${(offset / file.size * 100).toFixed(1)}%)`);
      }

      // Client-side progress: throttle to 4fps (250ms), capped at 95%
      const now = performance.now();
      if (now - lastProgressMs >= 250) {
        lastProgressMs = now;
        const clientCapped = Math.min(offset, Math.floor(file.size * 0.95));
        if (clientCapped > relayHighWater) onProgress?.(clientCapped, file.size);
      }
    }
    logger.info(`[WebRTC Upload] Sent all chunks: ${file.name}, ${chunkCount} chunks, ${offset} bytes`);
    
    // Verify upload completeness
    if (offset !== file.size) {
      logger.error(`❌ [WebRTC Upload] SIZE MISMATCH: sent ${offset} bytes but file is ${file.size} bytes!`);
      throw new Error(`Upload incomplete: sent ${offset}/${file.size} bytes`);
    }
  } catch (err) {
    logger.error(`[WebRTC Upload] Error at offset ${offset}/${file.size}:`, err);
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
