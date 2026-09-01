import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sourceConnectionId, composeFilePath, targetConnectionId } = body;

    if (!sourceConnectionId || !composeFilePath || !targetConnectionId) {
      return NextResponse.json({ success: false, error: 'Missing sourceConnectionId, composeFilePath, or targetConnectionId' }, { status: 400 });
    }

    const deployId = crypto.randomUUID().substring(0, 8);
    const sourceSshConfig = await getSshConfig(sourceConnectionId);
    const targetSshConfig = await getSshConfig(targetConnectionId);

    // 1. Read the compose file from source server
    logger.info(`[deploy-compose] Reading compose file from source: ${composeFilePath}`);
    // composeFilePath is caller-supplied — shell-quote it before it reaches the shell.
    const qComposeFilePath = shellQuote(composeFilePath);
    const readResult = await execCommand(sourceSshConfig, `cat ${qComposeFilePath}`);

    if (readResult.code !== 0) {
      return NextResponse.json({ success: false, error: `Failed to read compose file: ${readResult.stderr}` }, { status: 400 });
    }

    let composeContent = readResult.stdout;
    if (!composeContent.trim()) {
      return NextResponse.json({ success: false, error: 'Compose file is empty' }, { status: 400 });
    }

    // 2. Check for .env file in the same directory
    const composeDir = composeFilePath.substring(0, composeFilePath.lastIndexOf('/')) || '/tmp';
    let envContent = '';
    const envResult = await execCommand(sourceSshConfig, `cat ${shellQuote(`${composeDir}/.env`)} 2>/dev/null || true`);
    if (envResult.code === 0 && envResult.stdout.trim()) {
      envContent = envResult.stdout;
    }

    // 3. Get actual ports from running containers on source server
    const composeFileName = composeFilePath.split('/').pop();
    let containerPorts = {};
    
    try {
      const qComposeDir = shellQuote(composeDir);
      const qComposeFile = shellQuote(composeFileName);
      const psResult = await execCommand(sourceSshConfig, `cd ${qComposeDir} && docker compose -f ${qComposeFile} ps -q 2>/dev/null || docker-compose -f ${qComposeFile} ps -q 2>/dev/null || echo ""`);
      
      if (psResult.code === 0 && psResult.stdout.trim()) {
        const containerIds = psResult.stdout.trim().split('\n').filter(l => l.trim());
        
        for (const containerId of containerIds) {
          try {
            // Get container name and ports
            const inspectResult = await execCommand(sourceSshConfig, `docker inspect --format '{{.Name}}|{{json .HostConfig.PortBindings}}|{{json .Config.Image}}' ${shellQuote(containerId.trim())} 2>/dev/null || echo ""`);
            if (inspectResult.code === 0 && inspectResult.stdout.trim()) {
              const parts = inspectResult.stdout.trim().split('|');
              const name = parts[0]?.replace(/^\//, '');
              const portBindings = JSON.parse(parts[1] || '{}');
              const image = parts[2]?.replace(/"/g, '');
              
              // Extract service name from container name (usually project_service_1 or project-service-1)
              const serviceName = name?.split(/[-_]/).slice(-2, -1)[0] || name;
              
              const ports = [];
              for (const [containerPort, hostBindings] of Object.entries(portBindings || {})) {
                if (hostBindings && hostBindings.length > 0) {
                  for (const binding of hostBindings) {
                    const hostPort = binding.HostPort;
                    const hostIp = binding.HostIp || '0.0.0.0';
                    const cp = containerPort.split('/')[0];
                    if (hostPort) {
                      if (hostIp && hostIp !== '0.0.0.0') {
                        ports.push(`${hostIp}:${hostPort}:${cp}`);
                      } else {
                        ports.push(`${hostPort}:${cp}`);
                      }
                    }
                  }
                }
              }
              
              if (ports.length > 0) {
                containerPorts[serviceName] = { ports, image };
              }
            }
          } catch {}
        }
      }
    } catch {}

    // 4. Add missing ports to compose file if containers have ports not in compose
    const lines = composeContent.split('\n');
    const newLines = [];
    let currentServiceName = null;
    let inServices = false;
    let inPorts = false;
    let portsAdded = new Set();
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Track services section
      if (/^services:\s*$/.test(trimmed)) {
        inServices = true;
        newLines.push(line);
        continue;
      }
      
      if (inServices) {
        // New top-level key
        if (/^[a-zA-Z]/.test(trimmed) && !trimmed.startsWith(' ')) {
          inServices = false;
          currentServiceName = null;
          newLines.push(line);
          continue;
        }
        
        // Service name
        const serviceMatch = trimmed.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
        if (serviceMatch) {
          currentServiceName = serviceMatch[1];
          inPorts = false;
          newLines.push(line);
          continue;
        }
        
        // Check for ports section
        if (currentServiceName && trimmed === 'ports:') {
          inPorts = true;
          newLines.push(line);
          continue;
        }
        
        // End of ports section
        if (inPorts && !trimmed.startsWith('- ') && trimmed !== '') {
          inPorts = false;
          
          // Add missing ports from running container
          if (containerPorts[currentServiceName] && !portsAdded.has(currentServiceName)) {
            const containerPortList = containerPorts[currentServiceName].ports;
            const composePorts = []; // We'll collect existing ports
            
            // Look back to find existing ports
            for (let j = newLines.length - 1; j >= 0; j--) {
              if (newLines[j].trim().startsWith('- ') || newLines[j].trim() === 'ports:') {
                if (newLines[j].trim().startsWith('- ')) {
                  composePorts.push(newLines[j].trim().replace(/^-\s*/, '').replace(/"/g, ''));
                }
              } else {
                break;
              }
            }
            
            // Add ports that aren't already in compose
            for (const port of containerPortList) {
              if (!composePorts.some(p => p.includes(port.split(':')[0]))) {
                const indent = '      '; // 6 spaces for port entries
                newLines.push(`${indent}- "${port}"`);
              }
            }
            portsAdded.add(currentServiceName);
          }
        }
        
        // If we're at a new property (not ports), check if we need to add ports
        if (currentServiceName && !inPorts && trimmed.match(/^\s{4}[a-z]/)) {
          if (containerPorts[currentServiceName] && !portsAdded.has(currentServiceName)) {
            // Check if this service has a ports section by looking back
            let hasPorts = false;
            for (let j = newLines.length - 1; j >= 0; j--) {
              if (newLines[j].trim() === 'ports:') {
                hasPorts = true;
                break;
              }
              if (newLines[j].match(/^  [a-zA-Z0-9_-]+:\s*$/)) {
                break;
              }
            }
            
            if (!hasPorts) {
              // Add ports section before current line
              const indent = '    '; // 4 spaces for service properties
              newLines.push(`${indent}ports:`);
              for (const port of containerPorts[currentServiceName].ports) {
                newLines.push(`${indent}  - "${port}"`);
              }
              portsAdded.add(currentServiceName);
            }
          }
        }
      }
      
      newLines.push(line);
    }
    
    composeContent = newLines.join('\n');

    // 5. Parse networks from compose file (both defined and external)
    const networks = [];
    let inNetworks = false;
    let currentNetwork = null;
    
    for (const line of composeContent.split('\n')) {
      const trimmed = line.trim();
      
      // Detect top-level "networks:" section
      if (/^networks:\s*$/.test(trimmed) || /^networks:\s*#/.test(trimmed)) {
        inNetworks = true;
        continue;
      }
      
      if (inNetworks) {
        // New top-level key ends networks section
        if (/^[a-zA-Z]/.test(trimmed) && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
          inNetworks = false;
          continue;
        }
        
        // Network name (2 spaces indent)
        const netMatch = trimmed.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
        if (netMatch) {
          currentNetwork = { name: netMatch[1], external: false, driver: 'bridge' };
          networks.push(currentNetwork);
          continue;
        }
        
        // Network properties
        if (currentNetwork) {
          if (trimmed.includes('external: true') || trimmed.includes('external:true')) {
            currentNetwork.external = true;
          }
          const driverMatch = trimmed.match(/driver:\s*(\w+)/);
          if (driverMatch) {
            currentNetwork.driver = driverMatch[1];
          }
        }
      }
    }

    // Also check for network references in services
    const serviceNetworks = new Set();
    let inServicesForNetworks = false;
    let inServiceNetworks = false;
    
    for (const line of composeContent.split('\n')) {
      const trimmed = line.trim();
      
      if (/^services:\s*$/.test(trimmed)) {
        inServicesForNetworks = true;
        continue;
      }
      
      if (inServicesForNetworks) {
        if (/^[a-zA-Z]/.test(trimmed) && !trimmed.startsWith(' ')) {
          inServicesForNetworks = false;
          inServiceNetworks = false;
          continue;
        }
        
        if (trimmed === 'networks:') {
          inServiceNetworks = true;
          continue;
        }
        
        if (inServiceNetworks && trimmed.startsWith('- ')) {
          const netName = trimmed.replace(/^-\s*/, '').trim();
          if (netName && !netName.includes(':')) {
            serviceNetworks.add(netName);
          }
        }
        
        // End of networks section in service
        if (inServiceNetworks && !trimmed.startsWith('- ') && !trimmed.startsWith(' ')) {
          inServiceNetworks = false;
        }
      }
    }

    // Combine all networks
    const allNetworks = new Set([...networks.map(n => n.name), ...serviceNetworks]);

    // 6. Deploy on target server
    const targetPath = `/tmp/docker_deploy_${deployId}`;
    const qTargetPath = shellQuote(targetPath);

    // Build the deploy script
    let deployScript = `#!/bin/bash
set -e
DOCKER="docker"
COMPOSE="docker compose"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="sudo docker-compose"
  fi
fi

LOG=""
log() { echo "[deploy] $1"; LOG="$LOG\\n$1"; }

# Create temp directory
mkdir -p ${qTargetPath}
cd ${qTargetPath}

log "Compose file transferred to target server"
log "File: ${qTargetPath}/${qComposeFile}"

`;

    // Add network creation commands
    if (allNetworks.size > 0) {
      deployScript += `
# Ensure required networks exist
log "Checking/creating networks..."
`;
      for (const netName of allNetworks) {
        const netDef = networks.find(n => n.name === netName);
        const driver = netDef?.driver || 'bridge';
        deployScript += `
if ! $DOCKER network inspect ${shellQuote(netName)} >/dev/null 2>&1; then
  log "  Creating network: ${shellQuote(netName)} (driver: ${shellQuote(driver)})"
  $DOCKER network create --driver ${shellQuote(driver)} ${shellQuote(netName)} 2>&1 | while read line; do log "    $line"; done
else
  log "  Network ${shellQuote(netName)} already exists"
fi
`;
      }
    }

    deployScript += `
# Pull images first
log "Pulling images..."
$COMPOSE pull 2>&1 | while read line; do log "  $line"; done

# Stop existing containers if any
log "Stopping existing containers..."
$COMPOSE down 2>/dev/null || true

# Start containers
log "Starting containers..."
$COMPOSE up -d 2>&1 | while read line; do log "  $line"; done

log "Containers started successfully"

# List running containers
log "Running containers:"
$COMPOSE ps 2>&1 | while read line; do log "  $line"; done

# Cleanup
log "Cleaning up temporary files..."
rm -rf ${qTargetPath}

log "Compose deployment complete!"
echo "---RESULT---"
echo "$LOG"
echo "---END---"
`;

    // Write files over the wire as base64.
    //
    // A quoted heredoc (`<<'EOF'`) stops $-expansion, but it does NOT protect
    // against the content containing a line equal to the delimiter — that ends
    // the heredoc early and everything after it runs as shell. Since the
    // compose content comes from a file on the source server, an attacker who
    // controls that file (or can point the UI at it) could smuggle a
    // `COMPOSE_EOF` line and get arbitrary commands executed on the target.
    // base64 removes the problem entirely: the shell only ever sees [A-Za-z0-9+/=].
    const writeComposeCmd = `mkdir -p ${qTargetPath} && printf '%s' ${shellQuote(Buffer.from(composeContent, 'utf8').toString('base64'))} | base64 -d > ${qTargetPath}/${qComposeFile}`;
    await execCommand(targetSshConfig, writeComposeCmd);

    // Write .env file if exists
    if (envContent) {
      const writeEnvCmd = `printf '%s' ${shellQuote(Buffer.from(envContent, 'utf8').toString('base64'))} | base64 -d > ${qTargetPath}/.env`;
      await execCommand(targetSshConfig, writeEnvCmd);
    }

    // Write and execute the deploy script
    const scriptPath = `/tmp/docker_deploy_${deployId}.sh`;
    const qScriptPath = shellQuote(scriptPath);
    const writeScriptCmd = `printf '%s' ${shellQuote(Buffer.from(deployScript, 'utf8').toString('base64'))} | base64 -d > ${qScriptPath} && chmod +x ${qScriptPath}`;
    await execCommand(targetSshConfig, writeScriptCmd);

    const result = await execCommand(targetSshConfig, `bash ${qScriptPath} 2>&1; echo "EXIT_CODE=$?"`);

    const exitCode = result.stdout.match(/EXIT_CODE=(\d+)/)?.[1];
    const resultLog = result.stdout.match(/---RESULT---\n([\s\S]*?)---END---/)?.[1]?.trim();

    // Cleanup script
    await execCommand(targetSshConfig, `rm -f ${qScriptPath} 2>/dev/null; rm -rf ${qTargetPath} 2>/dev/null`);

    return NextResponse.json({
      success: exitCode === '0',
      logs: resultLog || result.stdout,
      exitCode: parseInt(exitCode || '1'),
    });

  } catch (error) {
    logger.error('[deploy-compose] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
