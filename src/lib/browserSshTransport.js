/**
 * Browser-side SSH Transport for ssh2
 *
 * Replaces the default TCP transport with a WebSocket relay transport.
 * The browser runs ssh2 natively, but TCP connections go through
 * the server's WebSocket relay instead of direct TCP.
 *
 * Usage:
 *   const transport = new BrowserSshTransport(socket);
 *   const sshClient = new Client();
 *   sshClient.connect({
 *     sock: transport.createSocket(),
 *     host: 'target-server',
 *     port: 22,
 *     username: 'root',
 *     password: 'secret',
 *   });
 */

export class BrowserSshTransport {
  constructor(relaySocket) {
    this.relaySocket = relaySocket;
    this.eventHandlers = {};
    this.connected = false;
    this.destroyed = false;
  }

  /**
   * Create a fake TCP socket that routes through the WebSocket relay
   */
  createSocket() {
    const self = this;
    const handlers = {};

    const fakeSocket = {
      // TCP socket-like interface
      connect(port, host, callback) {
        self._connectCallback = callback;
        self.relaySocket.emit('relay:connect', {
          host,
          port,
          sourceIp: self._getClientIp(),
        });
        return fakeSocket;
      },

      write(data, callback) {
        if (self.destroyed) return false;
        // Convert string to buffer if needed
        const buf = typeof data === 'string' ? Buffer.from(data) : data;
        self.relaySocket.emit('relay:data', buf);
        if (callback) callback();
        return true;
      },

      destroy() {
        self.destroyed = true;
        self.relaySocket.emit('relay:close');
        if (handlers.close) handlers.close();
      },

      end() {
        self.destroyed = true;
        self.relaySocket.emit('relay:close');
        if (handlers.close) handlers.close();
      },

      setKeepAlive(enable, initialDelay) {
        // No-op — WebSocket handles keepalive
      },

      setNoDelay(noDelay) {
        // No-op
      },

      setTimeout(timeout, callback) {
        // No-op for now
      },

      ref() {},
      unref() {},

      // Event emitter interface
      on(event, handler) {
        handlers[event] = handler;
        return fakeSocket;
      },

      once(event, handler) {
        handlers[event] = (...args) => {
          delete handlers[event];
          handler(...args);
        };
        return fakeSocket;
      },

      removeListener(event, handler) {
        delete handlers[event];
        return fakeSocket;
      },

      emit(event, ...args) {
        if (handlers[event]) handlers[event](...args);
      },

      // Properties ssh2 expects
      remoteAddress: undefined,
      remotePort: undefined,
    };

    // Wire up relay events to fake socket
    this.relaySocket.on('relay:connected', (opts) => {
      self.connected = true;
      fakeSocket.remoteAddress = opts.host;
      fakeSocket.remotePort = opts.port;
      if (self._connectCallback) {
        self._connectCallback();
      }
    });

    this.relaySocket.on('relay:data', (data) => {
      if (!self.destroyed && handlers.data) {
        // data comes as ArrayBuffer or Buffer
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        handlers.data(buf);
      }
    });

    this.relaySocket.on('relay:error', (err) => {
      if (handlers.error) {
        handlers.error(new Error(err.message || 'Relay error'));
      }
    });

    this.relaySocket.on('relay:closed', () => {
      self.connected = false;
      if (handlers.close) handlers.close();
    });

    return fakeSocket;
  }

  _getClientIp() {
    // The server will get the real IP from the WebSocket connection
    return undefined;
  }
}
