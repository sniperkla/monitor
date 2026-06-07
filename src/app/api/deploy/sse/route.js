import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';

// Store active SSE connections
const sseClients = new Map();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project') || 'default';

  console.log(`[deploymentSSE] New client connected for project: ${projectId}`);

  // Set up SSE response
  const encoder = new TextEncoder();
  const customReadable = new ReadableStream({
    async start(controller) {
      // Register this client
      if (!sseClients.has(projectId)) {
        sseClients.set(projectId, []);
      }
      const clients = sseClients.get(projectId);
      const clientId = Math.random().toString(36);
      const clientObj = { id: clientId, controller };
      clients.push(clientObj);

      // Send initial status
      try {
        await connectDB(process.env.MONGODB_URI, true);
        const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
        const setting = await SystemSetting.findOne({ key: dbKey });
        const config = setting?.value;

        if (config) {
          const message = `data: ${JSON.stringify({
            type: 'init',
            status: config.status,
            lastDeployLog: config.lastDeployLog,
            lastDeployAt: config.lastDeployAt
          })}\n\n`;
          controller.enqueue(encoder.encode(message));
        }
      } catch (err) {
        console.error('[deploymentSSE] Failed to send initial status:', err.message);
      }

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        const idx = clients.indexOf(clientObj);
        if (idx > -1) {
          clients.splice(idx, 1);
        }
        try {
          controller.close();
        } catch (e) {
          // Ignore if already closed/aborted
        }
        console.log(`[deploymentSSE] Client disconnected: ${clientId}`);
      });
    }
  });

  return new NextResponse(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

// Broadcast deployment status to all connected clients for a project
export async function broadcastDeploymentStatus(projectId = 'default') {
  const clients = sseClients.get(projectId) || [];
  if (clients.length === 0) return;

  try {
    await connectDB(process.env.MONGODB_URI, true);
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
    const setting = await SystemSetting.findOne({ key: dbKey });
    const config = setting?.value;

    if (!config) return;

    const encoder = new TextEncoder();
    const message = `data: ${JSON.stringify({
      type: 'statusUpdate',
      project: projectId,
      status: config.status,
      lastDeployLog: config.lastDeployLog,
      lastDeployAt: config.lastDeployAt
    })}\n\n`;

    const encoded = encoder.encode(message);

    // Send to all connected clients
    clients.forEach(clientObj => {
      try {
        clientObj.controller.enqueue(encoded);
      } catch (err) {
        console.error(`[deploymentSSE] Failed to send to client ${clientObj.id}:`, err.message);
      }
    });

    console.log(`[deploymentSSE] Broadcast to ${clients.length} clients for project: ${projectId}`);
  } catch (err) {
    console.error('[deploymentSSE] Broadcast error:', err.message);
  }
}
