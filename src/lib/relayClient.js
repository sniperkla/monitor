/**
 * Browser-side Relay Client
 *
 * Connects to the /relay namespace on the server.
 * The server handles SSH protocol (browsers can't do SSH natively),
 * but with minimal overhead — no session tracking, no SFTP, no exec queue.
 *
 * This is much lighter than the full Socket.io SSH handler.
 */

import { io } from 'socket.io-client';

export class RelayClient {
  constructor(options = {}) {
    this.socket = null;
    this.connected = false;
    this.handlers = {};
    this.serverUrl = options.serverUrl || window.location.origin;
  }

  /**
   * Connect to the relay namespace
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(`${this.serverUrl}/relay`, {
        path: '/api/socket',
        transports: ['websocket', 'polling'],
        withCredentials: true,
      });

      this.socket.on('connect', () => {
        console.log('[relay-client] Connected to /relay');
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        console.error('[relay-client] Connection error:', err.message);
        reject(err);
      });

      this.socket.on('relay:connected', (opts) => {
        this.connected = true;
        this._emit('connected', opts);
      });

      this.socket.on('relay:data', (data) => {
        this._emit('data', data);
      });

      this.socket.on('relay:error', (err) => {
        this._emit('error', err);
      });

      this.socket.on('relay:closed', () => {
        this.connected = false;
        this._emit('closed');
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this._emit('disconnected');
      });
    });
  }

  /**
   * Request SSH connection through the relay
   */
  requestConnection(connectionData, cols, rows) {
    if (!this.socket) throw new Error('Not connected');
    this.socket.emit('relay:connect', {
      connectionId: connectionData._id,
      connection: connectionData,
      cols,
      rows,
    });
  }

  /**
   * Send input to SSH
   */
  write(data) {
    if (this.socket && this.connected) {
      this.socket.emit('relay:data', data);
    }
  }

  /**
   * Request terminal resize
   */
  resize(cols, rows) {
    if (this.socket && this.connected) {
      this.socket.emit('relay:resize', { cols, rows });
    }
  }

  /**
   * Close the connection
   */
  close() {
    if (this.socket) {
      this.socket.emit('relay:close');
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Register event handler
   */
  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    return this;
  }

  /**
   * Remove event handler
   */
  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
    return this;
  }

  _emit(event, ...args) {
    (this.handlers[event] || []).forEach(h => h(...args));
  }
}
