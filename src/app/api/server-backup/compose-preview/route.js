import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const filePath = searchParams.get('filePath');

    if (!connectionId || !filePath) {
      return NextResponse.json({ success: false, error: 'Missing connectionId or filePath' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);

    // Read the compose file
    const readResult = await execCommand(sshConfig, `cat '${filePath}' 2>/dev/null`);
    if (readResult.code !== 0) {
      return NextResponse.json({ success: false, error: 'Failed to read compose file' }, { status: 400 });
    }

    const content = readResult.stdout;
    if (!content.trim()) {
      return NextResponse.json({ success: true, services: [] });
    }

    // Parse services from YAML (simple parser - look for "services:" section)
    const services = [];
    const lines = content.split('\n');
    let inServices = false;
    let currentService = null;
    let indentLevel = 0;

    for (const line of lines) {
      const trimmed = line.trimEnd();
      
      // Detect "services:" section
      if (/^services:\s*$/.test(trimmed) || /^services:\s*#/.test(trimmed)) {
        inServices = true;
        continue;
      }

      if (inServices) {
        // Check if we're still in services section (new top-level key)
        if (/^[a-zA-Z]/.test(trimmed) && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
          // Check if this is a new top-level key (not a service)
          if (!trimmed.includes(':') || /^[a-z]+:$/.test(trimmed.split(':')[0])) {
            const key = trimmed.split(':')[0].trim();
            // These are top-level keys that end the services section
            if (['volumes', 'networks', 'configs', 'secrets', 'version'].includes(key)) {
              inServices = false;
              continue;
            }
          }
        }

        // Detect service name (2 spaces indent, ends with colon)
        const serviceMatch = trimmed.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
        if (serviceMatch) {
          currentService = {
            name: serviceMatch[1],
            image: null,
            ports: [],
            volumes: [],
            env: [],
            running: false,
          };
          services.push(currentService);
          indentLevel = 4;
          continue;
        }

        // Parse service properties
        if (currentService && trimmed.startsWith(' '.repeat(indentLevel))) {
          const propLine = trimmed.trim();
          
          // Image
          const imageMatch = propLine.match(/^image:\s*(.+)$/);
          if (imageMatch) {
            currentService.image = imageMatch[1].trim().replace(/['"]/g, '');
          }

          // Ports
          const portMatch = propLine.match(/^-?\s*"?(\d+:\d+(?:\/\w+)?)"?\s*$/);
          if (portMatch) {
            currentService.ports.push(portMatch[1]);
          }

          // Volumes
          const volumeMatch = propLine.match(/^-?\s*(.+):(.+)(?::(.+))?\s*$/);
          if (volumeMatch && !portMatch) {
            currentService.volumes.push(volumeMatch[0].replace(/^-\s*/, '').trim());
          }

          // Environment
          const envMatch = propLine.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
          if (envMatch) {
            currentService.env.push(`${envMatch[1]}=${envMatch[2]}`);
          }
        }
      }
    }

    // Check which services are currently running on the source server
    const composeDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/tmp';
    const composeFileName = filePath.split('/').pop();
    
    // Try to get running containers from docker compose
    try {
      const psResult = await execCommand(sshConfig, `cd '${composeDir}' && docker compose -f '${composeFileName}' ps --format json 2>/dev/null || docker-compose -f '${composeFileName}' ps --format json 2>/dev/null || echo "[]"`);
      if (psResult.code === 0 && psResult.stdout.trim()) {
        const psLines = psResult.stdout.trim().split('\n').filter(l => l.trim());
        for (const line of psLines) {
          try {
            const container = JSON.parse(line);
            const serviceName = container.Service || container.service || container.Name?.split('-').pop();
            const state = container.State || container.state || '';
            const existing = services.find(s => s.name === serviceName);
            if (existing) {
              existing.running = state.toLowerCase().includes('running');
              existing.containerId = container.ID || container.id;
              existing.containerState = state;
            }
          } catch {}
        }
      }
    } catch {}

    return NextResponse.json({
      success: true,
      services: services.map(s => ({
        name: s.name,
        image: s.image,
        ports: s.ports,
        volumes: s.volumes.length,
        env: s.env.length,
        running: s.running,
        containerState: s.containerState || null,
      })),
    });

  } catch (error) {
    console.error('[compose-preview] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
