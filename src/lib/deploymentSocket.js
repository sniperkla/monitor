// WebSocket manager for real-time deployment updates
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

let listeners = {
  statusUpdate: [],
  connected: [],
  disconnected: [],
  error: []
};

export function subscribeToDeploymentUpdates(callback) {
  listeners.statusUpdate.push(callback);
  return () => {
    listeners.statusUpdate = listeners.statusUpdate.filter(cb => cb !== callback);
  };
}

export function subscribeToConnected(callback) {
  listeners.connected.push(callback);
  return () => {
    listeners.connected = listeners.connected.filter(cb => cb !== callback);
  };
}

export function subscribeToDisconnected(callback) {
  listeners.disconnected.push(callback);
  return () => {
    listeners.disconnected = listeners.disconnected.filter(cb => cb !== callback);
  };
}

export function subscribeToError(callback) {
  listeners.error.push(callback);
  return () => {
    listeners.error = listeners.error.filter(cb => cb !== callback);
  };
}

function emitStatusUpdate(data) {
  listeners.statusUpdate.forEach(cb => cb(data));
}

function emitConnected() {
  listeners.connected.forEach(cb => cb());
}

function emitDisconnected() {
  listeners.disconnected.forEach(cb => cb());
}

function emitError(error) {
  listeners.error.forEach(cb => cb(error));
}

export function connectDeploymentSocket(projectId = 'default') {
  if (typeof window === 'undefined') return;

  // Determine WS URL based on current location
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/api/deploy/socket?project=${projectId}`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[deploymentSocket] Connected');
    reconnectAttempts = 0;
    emitConnected();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[deploymentSocket] Received:', data);
      emitStatusUpdate(data);
    } catch (err) {
      console.error('[deploymentSocket] Failed to parse message:', err);
    }
  };

  socket.onerror = (error) => {
    console.error('[deploymentSocket] Error:', error);
    emitError(error);
  };

  socket.onclose = () => {
    console.log('[deploymentSocket] Disconnected');
    emitDisconnected();
    
    // Auto-reconnect with exponential backoff
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1);
      console.log(`[deploymentSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(() => connectDeploymentSocket(projectId), delay);
    }
  };
}

export function disconnectDeploymentSocket() {
  if (socket) {
    socket.close();
    socket = null;
    emitDisconnected();
  }
}

export function isConnected() {
  return socket && socket.readyState === WebSocket.OPEN;
}

export function sendDeploymentMessage(data) {
  if (isConnected()) {
    socket.send(JSON.stringify(data));
  } else {
    console.warn('[deploymentSocket] Not connected, cannot send message');
  }
}
