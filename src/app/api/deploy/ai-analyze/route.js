import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { exec } from 'child_process';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import OpenAI from 'openai';

// Supported model options
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project') || 'default';
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    const { targetType, connectionId, projectPath, deployCommand: inputDeployCommand, aiModel, aiCustomModel, aiEndpoint: aiEndpointBody, aiApiKey: aiApiKeyBody } = await request.json();

    if (!targetType) {
      return NextResponse.json({ success: false, error: 'Target type is required' }, { status: 400 });
    }

    let filesListing = '';
    const resolvedPath = projectPath?.trim() || '.';
    
    // Sanitize projectPath to prevent command injection
    if (/[;&|`$(){}!#]/.test(resolvedPath) || resolvedPath.includes('..')) {
      return NextResponse.json({ success: false, error: 'Invalid project path' }, { status: 400 });
    }

    // Use semicolons to separate commands so a missing file won't break the chain.
    // cat with 2>/dev/null exits code 1 when file missing — breaking && chain completely.
    const probeParts = [
      // --- Project files (each runs independently with ;) ---
      `cd "${resolvedPath}"`,
      `echo "=== LS ==="`,
      `ls -la 2>/dev/null || true`,
      `echo "=== PACKAGE JSON ==="`,
      `cat package.json 2>/dev/null || true`,
      `echo "=== DOCKER COMPOSE ==="`,
      `cat docker-compose.yml 2>/dev/null || cat docker-compose.yaml 2>/dev/null || echo "No docker-compose.yml found"`,
      `echo "=== DOCKERFILE ==="`,
      `cat Dockerfile 2>/dev/null || true`,
      `echo "=== REQUIREMENTS ==="`,
      `cat requirements.txt 2>/dev/null || true`,
      `cat pyproject.toml 2>/dev/null || true`,
      `cat pom.xml 2>/dev/null || true`,
      `cat build.gradle 2>/dev/null || true`,

      // --- System info ---
      `echo "=== SYSTEM INFORMATION ==="`,
      `uname -a 2>/dev/null || true`,
      `cat /etc/os-release 2>/dev/null | grep -E "^(NAME|VERSION)=" || true`,

      // --- Docker environment ---
      `echo "=== DOCKER VERSION ==="`,
      `docker --version 2>/dev/null || echo "Docker not installed"`,
      `echo "=== DOCKER COMPOSE PLUGIN ==="`,
      `docker compose version 2>/dev/null || echo "Plugin docker compose NOT available"`,
      `echo "=== DOCKER COMPOSE LEGACY BINARY ==="`,
      `docker-compose --version 2>/dev/null || echo "Binary docker-compose NOT available"`,
      `echo "=== DOCKER SWARM STATUS ==="`,
      `docker info 2>/dev/null | grep -i "Swarm:" || echo "Swarm status unknown"`,

      // --- Nginx config inspection ---
      `echo "=== NGINX CONFIG (from container) ==="`,
      `docker exec global-nginx cat /etc/nginx/nginx.conf 2>/dev/null || docker exec nginx cat /etc/nginx/nginx.conf 2>/dev/null || echo "Could not read nginx.conf from container"`,
      `echo "=== NGINX CONF.D (from container) ==="`,
      `docker exec global-nginx sh -c "ls /etc/nginx/conf.d/ 2>/dev/null && cat /etc/nginx/conf.d/*.conf 2>/dev/null" || docker exec nginx sh -c "ls /etc/nginx/conf.d/ 2>/dev/null && cat /etc/nginx/conf.d/*.conf 2>/dev/null" || echo "Could not read conf.d from container"`,
      `echo "=== NGINX SITES-ENABLED (from container) ==="`,
      `docker exec global-nginx sh -c "ls /etc/nginx/sites-enabled/ 2>/dev/null && cat /etc/nginx/sites-enabled/* 2>/dev/null" || docker exec nginx sh -c "ls /etc/nginx/sites-enabled/ 2>/dev/null && cat /etc/nginx/sites-enabled/* 2>/dev/null" || echo "No sites-enabled in container"`,
      `echo "=== NGINX CONFIG (host filesystem) ==="`,
      `cat /etc/nginx/nginx.conf 2>/dev/null || echo "No host nginx.conf"`,
      `find /etc/nginx/conf.d /etc/nginx/sites-enabled /home/*/nginx /root/nginx 2>/dev/null -name "*.conf" | head -20 | xargs -I{} sh -c 'echo "--- {} ---" && cat {}' 2>/dev/null || true`,
    ];
    const probeCmd = probeParts.join(' ; ');

    if (targetType === 'local') {
      filesListing = await new Promise((resolve) => {
        exec(probeCmd, { timeout: 30000 }, (error, stdout, stderr) => {
          resolve((stdout || stderr || error?.message || '').toString());
        });
      });
    } else if (targetType === 'ssh') {
      if (!connectionId) {
        return NextResponse.json({ success: false, error: 'Connection ID is required for SSH target' }, { status: 400 });
      }
      const db = await connectDB();
      const repo = new ConnectionRepository(db);
      await repo.init();
      const connection = await repo.findById(connectionId);
      if (!connection) {
        return NextResponse.json({ success: false, error: 'SSH Connection not found' }, { status: 404 });
      }

      const sshConfig = {
        host: connection.host,
        port: connection.port || 22,
        username: connection.username,
        readyTimeout: 20000,
      };

      if (connection.authType === 'password') {
        try { sshConfig.password = decrypt(connection.password); } catch (_) { sshConfig.password = connection.password; }
      } else if (connection.privateKey) {
        try { sshConfig.privateKey = decrypt(connection.privateKey); } catch (_) { sshConfig.privateKey = connection.privateKey; }
        if (connection.passphrase) {
          try { sshConfig.passphrase = decrypt(connection.passphrase); } catch (_) { sshConfig.passphrase = connection.passphrase; }
        }
      }

      filesListing = await new Promise((resolve) => {
        const conn = new Client();
        const sshTimeout = setTimeout(() => {
          conn.end();
          resolve('SSH Connection Error: timed out after 30 seconds');
        }, 30000);

        conn.on('ready', () => {
          clearTimeout(sshTimeout);
          conn.exec(probeCmd, { timeout: 30000 }, (err, stream) => {
            if (err) {
              conn.end();
              return resolve(`SSH Exec Error: ${err.message}`);
            }

            let output = '';
            stream.on('data', (data) => {
              output += data.toString();
            });
            stream.stderr.on('data', (data) => {
              output += data.toString();
            });
            stream.on('close', () => {
              conn.end();
              resolve(output);
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(sshTimeout);
          resolve(`SSH Connection Error: ${err.message}`);
        });

        conn.connect(sshConfig);
      });
    } else {
      return NextResponse.json({ success: false, error: 'Unsupported target type' }, { status: 400 });
    }

    // Load AI configurations
    await connectDB(process.env.MONGODB_URI, true);
    const keysSetting = await SystemSetting.findOne({ key: 'ai_api_keys' });
    const configSetting = await SystemSetting.findOne({ key: 'ai_config' });
    const projectSetting = await SystemSetting.findOne({ key: dbKey });
    const projectAiPrefs = projectSetting?.value || {};
    const existingScript = inputDeployCommand || projectAiPrefs.deployCommand || '';

    // Start with global Groq key as fallback
    let apiKey = process.env.GROQ_API_KEY || '';
    if (keysSetting?.value?.keys && Array.isArray(keysSetting.value.keys) && keysSetting.value.keys.length > 0) {
      const idx = keysSetting.value.currentIndex || 0;
      apiKey = keysSetting.value.keys[idx] || keysSetting.value.keys[0];
    }

    // Prefer request-body values first, then fall back to saved DB prefs
    const effectiveAiModel = aiModel || projectAiPrefs.aiModel;
    const effectiveAiCustomModel = aiCustomModel || projectAiPrefs.aiCustomModel;
    const effectiveAiEndpoint = (aiEndpointBody && aiEndpointBody.trim()) ? aiEndpointBody.trim() : (projectAiPrefs.aiEndpoint || '');
    const effectiveAiApiKey = (aiApiKeyBody && aiApiKeyBody.trim()) ? aiApiKeyBody.trim() : (projectAiPrefs.aiApiKey || '');

    let baseURL = GROQ_BASE_URL;
    let modelName = configSetting?.value?.model || FALLBACK_MODEL;
    let isCustomEndpoint = false;

    if (effectiveAiModel === 'manual' || (effectiveAiEndpoint && effectiveAiApiKey)) {
      // Custom endpoint mode: use user's base URL and key
      let userEndpoint = effectiveAiEndpoint || 'https://api.openai.com/v1';
      // Normalize base URL (strip /chat/completions if included)
      userEndpoint = userEndpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
      baseURL = userEndpoint;
      modelName = effectiveAiCustomModel || 'gpt-3.5-turbo';
      apiKey = effectiveAiApiKey || apiKey;
      isCustomEndpoint = !baseURL.includes('api.groq.com') && !baseURL.includes('api.openai.com');

      if (!apiKey) {
        return NextResponse.json({ success: false, error: 'Custom AI API Key is required. Enter your API key in the Auto Deploy → AI Settings section.' }, { status: 400 });
      }
    } else if (effectiveAiModel && effectiveAiModel !== 'auto') {
      modelName = effectiveAiModel;
    }

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'AI API Key is not configured. Please add a Groq API key in the global AI settings, or switch to Manual mode and enter a custom API key in the Auto Deploy settings.' }, { status: 400 });
    }

    // Check if the user has explicitly set up Swarm before (existing script has swarm/service commands)
    const isSwarmMode = /docker\s+(swarm|service|stack)/.test(existingScript);

    const systemPrompt = `You are a DevOps and Deployment agent. You will analyze a directory listing, environment probe output (OS, Docker version, Docker Compose capability, Nginx configuration), and an existing deployment script to produce an updated, production-ready deployment script.

CRITICAL INSTRUCTIONS:
1. ENVIRONMENT AWARENESS: Examine the === SYSTEM INFORMATION ===, === DOCKER VERSION ===, and === DOCKER COMPOSE === sections.
   - If "docker compose version" plugin is available, use \`docker compose up -d --build\`.
   - If only legacy "docker-compose" binary is available, use \`docker-compose up -d --build\`.
   - Use fallback pattern \`docker compose up -d --build 2>/dev/null || docker-compose up -d --build\` if uncertain.
2. NGINX CONFIG ANALYSIS: Examine the === NGINX CONFIG === and === NGINX CONF.D === sections carefully.
   - If nginx upstreams use \`proxy_pass http://CONTAINER_NAME:PORT\` — Docker services/containers MUST be named exactly CONTAINER_NAME.
   - If nginx upstreams use \`proxy_pass http://127.0.0.1:PORT\` — containers should publish PORT to the host.
   - Extract all upstream hostnames and ports from nginx config and include them in the summary so the system can match service names.
   - List found nginx upstreams in the "summary" field as: "nginx_upstreams: [{name: 'autfrontend', port: 3090}, ...]"
3. PRIMARY REQUIREMENT: If an existing deployment script is provided in the prompt below, YOU MUST USE IT AS YOUR EXACT STARTING MATERIAL / TEMPLATE.
4. PRESERVE ORIGINAL COMMANDS: Keep all original "cd" commands (e.g. \`cd /home/ec2-user/aut/\`), repository updates (\`git pull\`), custom environment setup, echo/log statements, and cleanup commands (\`docker image prune -f\`).
5. NO DUPLICATE HEADERS: Put \`#!/bin/bash\` and \`set -e\` ONLY ONCE at the very top of the script (lines 1 & 2). Never include nested \`#!/bin/bash\` or \`set -e\` inside \`if/else\` blocks.
6. DOCKER BUILD ONLY: Keep standard docker build or docker compose commands. Do NOT add any docker service, docker swarm, or docker stack commands — those are managed separately by the system.
7. END THE SCRIPT with the original echo completion message and image prune if present.

You MUST respond with a valid JSON object ONLY. Do not wrap the JSON in markdown formatting blocks or include any extra text. The JSON format must be EXACTLY:
{
  "projectType": "Name of project type",
  "technologies": ["tech1", "tech2", "tech3"],
  "deployCommand": "string representing shell script with newlines",
  "summary": "Concise summary including nginx_upstreams found in nginx config"
}`;

    const userPrompt = `Here is the scanned directory listing, project config files, system environment probe, and nginx config for the project path "${resolvedPath}":

${filesListing}

Pay special attention to:
- The === NGINX CONFIG === and === NGINX CONF.D === sections: extract all proxy_pass upstream hostnames and ports.
- The === DOCKER VERSION === and === DOCKER COMPOSE === sections: use the correct docker compose command for this environment.

Existing deployment script (USE AS BASELINE REFERENCE to preserve cd, git pull, etc.):
${existingScript || '# No previous script set'}`;

    console.log(`[ai-analyze] OpenAI SDK Client -> baseURL: ${baseURL} | model: ${modelName} | keyPrefix: ${apiKey ? apiKey.slice(0, 8) + '...' : 'EMPTY'}`);

    // Initialize official OpenAI client SDK
    const openai = new OpenAI({
      baseURL,
      apiKey,
    });

    let parsedResult = null;
    try {
      const completionParams = {
        model: modelName,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        ...(!isCustomEndpoint ? { response_format: { type: 'json_object' } } : {})
      };

      const completion = await openai.chat.completions.create(completionParams);
      const content = completion.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('AI returned an empty response. Check your model name and endpoint.');
      }

      // Parse JSON directly or extract from markdown ```json blocks
      try {
        parsedResult = JSON.parse(content);
      } catch (_) {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          parsedResult = JSON.parse(jsonMatch[1]);
        } else {
          throw new Error(`Could not parse JSON from AI response: ${content.slice(0, 200)}`);
        }
      }
    } catch (aiErr) {
      console.error('[ai-analyze] OpenAI SDK call failed:', aiErr.message);
      return NextResponse.json({ 
        success: false, 
        error: `AI analysis failed: ${aiErr.message}`
      }, { status: 500 });
    }

    if (!parsedResult) {
      return NextResponse.json({ success: false, error: 'AI did not return a valid response.' }, { status: 500 });
    }

    // --- SERVER-SIDE SWARM INJECTION ---
    // Extract service names from docker-compose.yml using container_name per service block
    let swarmBlock = '';
    let services = [];


    // Normalize CRLF line endings from SSH output (Windows-style may break regex)
    const normalizedListing = filesListing.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Parse docker-compose.yml content from filesListing
    // Primary: extract container_name entries directly
    const containerNameMatches = normalizedListing.match(/container_name:\s*([a-zA-Z0-9._-]+)/g);
    if (containerNameMatches && containerNameMatches.length > 0) {
      services = Array.from(new Set(containerNameMatches.map(m => m.replace(/container_name:\s*/, '').trim())));
      console.log(`[ai-analyze] Detected services from container_name: ${services.join(', ')}`);
    } else {
      // Fallback 1: Parse service keys under services: section
      const composeMatch = normalizedListing.match(/services:\s*\n([\s\S]*?)(?=\n[a-zA-Z0-9._-]+:|\n$|$)/);
      if (composeMatch) {
        const servicesBlock = composeMatch[1];
        const serviceKeys = servicesBlock.match(/^\s{2,4}([a-zA-Z0-9._-]+):/gm);
        if (serviceKeys) {
          services = Array.from(new Set(serviceKeys.map(k => k.trim().replace(':', ''))))
            .filter(svc => !/^(db|database|redis|mongo|mysql|postgres|rabbitmq|memcached|elasticsearch|zookeeper|kafka)$/i.test(svc));
          console.log(`[ai-analyze] Detected services from service keys: ${services.join(', ')}`);
        }
      }
    }

    // Fallback 2: Extract container names from AI-generated script (docker service create --name <NAME>)
    if (services.length === 0 && parsedResult?.deployCommand) {
      const scriptServiceMatches = parsedResult.deployCommand.match(/docker\s+(?:service\s+(?:create|update)|run|start)\s+(?:--[\w-]+\s+\S+\s+)*--name\s+([a-zA-Z0-9._-]+)/g);
      if (scriptServiceMatches && scriptServiceMatches.length > 0) {
        services = Array.from(new Set(scriptServiceMatches.map(m => m.match(/--name\s+([a-zA-Z0-9._-]+)/)?.[1]).filter(Boolean)));
        console.log(`[ai-analyze] Detected services from AI script: ${services.join(', ')}`);
      }
    }

    // Fallback 3: project folder name if all detection methods failed
    if (services.length === 0) {
      const folderName = resolvedPath.split('/').filter(Boolean).pop() || 'app';
      services = [folderName.toLowerCase().replace(/[^a-z0-9._-]/g, '')];
      console.warn(`[ai-analyze] WARNING: No services detected from docker-compose.yml or AI script. Falling back to folder name: ${services[0]}`);
    } else {
      console.log(`[ai-analyze] Final services for Swarm injection: ${services.join(', ')}`);
    }

    if (services.length > 0) {
      // Detect subfolder build contexts from docker-compose.yml (build: ./frontend etc)
      const buildLines = filesListing.match(/build:\s*(\S+)/g) || [];
      const buildDirs = buildLines.map(b => b.replace('build:', '').trim().replace(/^\.\//,''));

      // Detect ports per container: scan each container_name or service block for its ports
      const portMap = {};
      for (const svc of services) {
        // Find host:container port patterns near this service name
        const svcPortMatch = filesListing.match(new RegExp(`(?:container_name:|${svc}:)[\\s\\S]{0,400}?ports:[\\s\\S]{0,200}?-(\\s*['\"]?\\d+:\\d+['\"]?)`, 'm'));
        if (svcPortMatch) {
          const portLine = svcPortMatch[1].trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
          portMap[svc] = portLine;
        }
      }

      let buildSection = '';
      for (let i = 0; i < services.length; i++) {
        const svc = services[i];
        const dir = buildDirs[i] || '';
        // If dir is specified or subdir exists (e.g. frontend, backend)
        const subdir = dir || svc.replace(/^aut/i, '').replace(/^app/i, '').toLowerCase();
        
        buildSection += `
     # Build image for ${svc}
     if [ -n "${subdir}" ] && [ -d "${subdir}" ] && [ -f "${subdir}/Dockerfile" ]; then
       echo "Building ${svc}:latest from ./${subdir}..."
       docker build -t ${svc}:latest ./${subdir}
     elif [ -f "Dockerfile" ]; then
       echo "Building ${svc}:latest from ./..."
       docker build -t ${svc}:latest ./
     fi`;
      }

      let svcSection = '';
      for (const svc of services) {
        const port = portMap[svc] || '';
        const publishFlag = port ? `--publish ${port}` : '';
        svcSection += `

     # ------ ${svc} ------
     if docker service inspect ${svc} >/dev/null 2>&1; then
       echo "[swarm] Updating Swarm service ${svc} zero-downtime..."
       docker service update --image ${svc}:latest --update-order start-first --update-delay 5s ${svc}
       docker service update --network-add "$SWARM_NET" ${svc} 2>/dev/null || true
     else
       # Check if a standalone container with this name exists
       if docker inspect ${svc} >/dev/null 2>&1; then
         echo "[swarm] Migrating ${svc}: standalone container -> Swarm service..."
         docker stop ${svc} 2>/dev/null || true
         _HAD_CONTAINER=1
       else
         echo "[swarm] Creating fresh Swarm service ${svc} (no standalone container found)..."
         _HAD_CONTAINER=0
       fi
       # Create Swarm service — if it fails and we had a standalone container, roll back
       if docker service create --name ${svc} --network "$SWARM_NET" ${publishFlag} --detach --no-resolve-image --replicas 2 ${svc}:latest; then
         echo "[swarm] Service ${svc} created. Waiting for replica to start..."
         _STARTED=0
         for _i in 1 2 3 4 5 6 7 8 9 10; do
           _REPLICAS=$(docker service ls --filter name=^${svc}$ --format '{{.Replicas}}' 2>/dev/null || echo "0/2")
           _RUNNING=$(echo "$_REPLICAS" | cut -d'/' -f1)
           if [ "\${_RUNNING:-0}" -ge 1 ] 2>/dev/null; then
             _STARTED=1
             echo "[swarm] Service ${svc} running ($_REPLICAS)."
             if [ "$_HAD_CONTAINER" = "1" ]; then
               echo "[swarm] Removing old standalone container ${svc}..."
               docker rm ${svc} 2>/dev/null || true
             fi
             break
           fi
           echo "[swarm] Waiting for ${svc} replica... ($_i/10)"
           sleep 3
         done
         if [ "$_STARTED" = "0" ]; then
           echo "[swarm] WARNING: ${svc} service did not start replicas in time."
           [ "$_HAD_CONTAINER" = "1" ] && echo "[swarm] Old standalone container preserved for rollback."
         fi
       else
         echo "[swarm] ERROR: Failed to create Swarm service ${svc}."
         if [ "$_HAD_CONTAINER" = "1" ]; then
           echo "[swarm] Rolling back — restarting old container..."
           docker start ${svc} 2>/dev/null || true
         fi
       fi
     fi`;
      }

      swarmBlock = `
     # Docker Swarm Zero-Downtime Deployment
     docker swarm init 2>/dev/null || true
     docker swarm update --task-history-limit 1 2>/dev/null || true

     # Detect existing overlay network — use it if found, only create if none exist
     SWARM_NET=$(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v '^ingress$' | head -1)
     if [ -n "$SWARM_NET" ]; then
       echo "[net] Using existing overlay network: $SWARM_NET"
     else
       echo "[net] No overlay network found — creating proxy-net..."
       docker network create --driver overlay --attachable proxy-net
       # Wait up to 15s for the network to become visible
       for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
         SWARM_NET=$(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v '^ingress$' | head -1)
         if [ -n "$SWARM_NET" ]; then
           echo "[net] Overlay network ready: $SWARM_NET"
           break
         fi
         echo "[net] Waiting for overlay network to appear... ($i/15)"
         sleep 1
       done
       if [ -z "$SWARM_NET" ]; then
         echo "[net] ERROR: No overlay network available after 15s. Aborting."
         exit 1
       fi
     fi
${buildSection}
     # Fallback compose build
     docker compose build 2>/dev/null || docker-compose build 2>/dev/null || true
${svcSection}

     # Reconnect Nginx to all Swarm overlay networks
     NETS=$(docker network ls --filter driver=overlay --format "{{.Name}}")
     for net in $NETS; do
       docker network connect $net global-nginx 2>/dev/null || docker network connect $net nginx 2>/dev/null || true
     done
     docker exec global-nginx nginx -s reload 2>/dev/null || docker restart global-nginx 2>/dev/null || true

     docker container prune -f 2>/dev/null || true`;
    } // end isSwarmMode

    // Always build standardScript and swarmScript separately
    const standardScript = parsedResult.deployCommand || '';
    let swarmScript = standardScript;

    if (swarmBlock) {
      // Strip commands that conflict with Swarm mode:
      // 1. Any docker swarm/service/stack lines (the AI may have written them in the base script)
      // 2. docker-compose up/down / docker compose up/down — Swarm handles container lifecycle, not compose up
      // 3. docker image prune — the Swarm block already handles cleanup
      let cleanScript = standardScript
        .replace(/docker\s+(swarm|service|stack)\s+[^\n]*/g, '')       // remove swarm/service/stack lines
        .replace(/docker(-compose|\s+compose)\s+(up|down)\s+[^\n]*/g, '') // remove compose up/down
        .replace(/docker\s+image\s+prune\s+[^\n]*/g, '')               // remove image prune (Swarm block does this)
        .replace(/docker\s+container\s+prune\s+[^\n]*/g, '')           // remove container prune
        .replace(/\n\s*\n\s*\n/g, '\n\n');                             // collapse triple newlines

      // Insert swarm block before the final echo or at end
      const echoIdx = cleanScript.lastIndexOf('echo "Deployment completed');
      if (echoIdx !== -1) {
        swarmScript = cleanScript.slice(0, echoIdx) + swarmBlock + '\n\n     ' + cleanScript.slice(echoIdx);
      } else {
        swarmScript = cleanScript.trimEnd() + '\n' + swarmBlock;
      }
    }

    // Default deployCommand is swarmScript if user was already in swarm mode, else standardScript
    const finalScript = isSwarmMode ? swarmScript : standardScript;

    // Verify final script correctness: ensure all detected services exist in the Swarm script
    let validationWarning = '';
    if (isSwarmMode && services.length > 0) {
      const missingSvcs = services.filter(s => !finalScript.includes(s));
      if (missingSvcs.length > 0) {
        validationWarning = `⚠️ WARNING: Detected services [${missingSvcs.join(', ')}] were missing from the generated script. Please check your docker-compose.yml or click "Re-Analyze".`;
        console.warn(`[ai-analyze] ${validationWarning}`);
      }
    }

    const aiProfile = {
      projectType: parsedResult.projectType,
      technologies: parsedResult.technologies,
      deployCommand: finalScript,
      standardScript,
      swarmScript,
      summary: validationWarning ? `${validationWarning}\n\n${parsedResult.summary}` : parsedResult.summary,
      validationPassed: !validationWarning,
      detectedServices: services,
      analyzedAt: new Date()
    };

    // Re-fetch project setting to get latest value for saving
    const savedProjectSetting = await SystemSetting.findOne({ key: dbKey });
    const existingValue = savedProjectSetting?.value || {};

    const aiLogs = Array.isArray(existingValue.aiLogs) ? existingValue.aiLogs : [];
    aiLogs.unshift({
      ...aiProfile,
      targetType,
      resolvedPath
    });
    // Keep last 15 logs max
    if (aiLogs.length > 15) {
      aiLogs.pop();
    }

    const updatedValue = {
      ...existingValue,
      projectPath: resolvedPath,
      aiProfile,
      aiLogs
    };

    await SystemSetting.findOneAndUpdate(
      { key: dbKey },
      { $set: { value: updatedValue } },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      aiProfile,
      aiLogs
    });

  } catch (error) {
    console.error('[deploy/ai-analyze] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
