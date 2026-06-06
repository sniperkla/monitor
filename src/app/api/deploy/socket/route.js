import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';

// Store active WebSocket connections
const wsClients = new Map();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project') || 'default';

  // Check if the request supports WebSocket upgrade
  if (request.headers.get('upgrade') !== 'websocket') {
    return NextResponse.json({ error: 'Not a WebSocket request' }, { status: 400 });
  }

  // Note: Node.js doesn't natively support WebSocket upgrades in the standard HTTP handler
  // This endpoint would need to be handled by a custom server or middleware
  // For now, return a placeholder that guides toward alternative implementation
  return NextResponse.json({
    message: 'WebSocket upgrade required. Use a custom server handler.',
    project: projectId
  });
}

// Helper function to broadcast status to all connected clients for a project
export async function broadcastDeploymentStatus(projectId = 'default') {
  const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

  try {
    await connectDB(null, true);
    const setting = await SystemSetting.findOne({ key: dbKey });
    const config = setting?.value;

    if (!config) return;

    const clients = wsClients.get(projectId) || [];
    clients.forEach(client => {
      try {
        if (client.readyState === 1) { // OPEN
          client.send(JSON.stringify({
            type: 'statusUpdate',
            project: projectId,
            status: config.status,
            lastDeployLog: config.lastDeployLog,
            lastDeployAt: config.lastDeployAt
          }));
        }
      } catch (err) {
        console.error('Failed to send WebSocket message:', err.message);
      }
    });
  } catch (err) {
    console.error('Failed to broadcast deployment status:', err.message);
  }
}

export function registerWebSocketClient(projectId = 'default', client) {
  if (!wsClients.has(projectId)) {
    wsClients.set(projectId, []);
  }
  wsClients.get(projectId).push(client);
}

export function unregisterWebSocketClient(projectId = 'default', client) {
  const clients = wsClients.get(projectId);
  if (clients) {
    const index = clients.indexOf(client);
    if (index > -1) {
      clients.splice(index, 1);
    }
  }
}
