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
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';

// Supported model options
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

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
    const userIdQuery = resolveUserIdQuery(userId);
    const projectSetting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
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

    // Sanitize API key, base URL, and model name to pure ASCII printable characters to prevent ByteString header errors
    apiKey = (apiKey || '').replace(/[^\x20-\x7E]/g, '').trim();
    baseURL = (baseURL || '').replace(/[^\x20-\x7E]/g, '').trim();
    modelName = (modelName || '').replace(/[^\x20-\x7E]/g, '').trim();
    const safeFilesListing = (filesListing || '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uFFFF]/g, '');

    // Check if the user has explicitly set up Swarm before (existing script has swarm/service commands)
    const isSwarmMode = /docker\s+(swarm|service|stack)/.test(existingScript);

    const systemPrompt = `You are an expert DevOps AI agent analyzing a project repository, Docker Compose file, and Nginx reverse proxy configuration.

CRITICAL INSTRUCTIONS:
1. ENVIRONMENT & SERVICES IDENTIFICATION:
   - Carefully examine docker-compose.yml and Nginx proxy configs (proxy_pass directives).
   - Identify all application services (containers) that need to be built and deployed (e.g., frontend, backend).
   - Determine their container_name / service name, build context directory (e.g., ./frontend, ./backend, or ./), and exposed/proxied port (e.g., 3033, 3090).
2. SCRIPT CONSTRUCT & PRESERVATION:
   - If an existing deployment script is provided, keep all original "cd", "git pull", custom environment setup, echo/log statements.
   - Put \`#!/bin/bash\` ONLY ONCE at the top. Do NOT add \`set -e\` — Swarm rollback commands exit non-zero by design and set -e would abort the script mid-rollback.
   - Do NOT include any docker service/swarm commands in "deployCommand" — the system handles zero-downtime Swarm injection.

You MUST respond with a valid JSON object ONLY:
{
  "projectType": "Name of project type",
  "technologies": ["tech1", "tech2"],
  "services": [
    { "name": "service_container_name", "buildDir": "frontend_or_backend_or_empty", "port": 3033 }
  ],
  "deployCommand": "string representing standard bash script with newlines",
  "summary": "Concise summary of identified services, build context, and proxy ports"
}`;

    const userPrompt = `Here is the scanned directory listing, project config files, system environment probe, and nginx config for the project path "${resolvedPath}":

${safeFilesListing}

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

    // ─── SERVER-SIDE SWARM INJECTION ───────────────────────────────────────────
    let swarmBlock = '';
    let services = [];

    // Normalize CRLF from SSH output
    const normalizedListing = filesListing.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // ── Step 1: Extract docker-compose.yml content ───────────────────────────
    // Probe echoes "=== DOCKER COMPOSE ===" before catting the file — use it as a fence
    const composeMarkerIdx = normalizedListing.indexOf('=== DOCKER COMPOSE ===');
    let composeContent = '';
    if (composeMarkerIdx !== -1) {
      const afterMarker = normalizedListing.slice(composeMarkerIdx + 22);
      // Stop at the next "===" section marker
      const nextMarkerIdx = afterMarker.indexOf('\n===');
      composeContent = (nextMarkerIdx !== -1 ? afterMarker.slice(0, nextMarkerIdx) : afterMarker).trim();
    }
    // Fallback: search the whole listing if marker not found
    if (!composeContent) composeContent = normalizedListing;
    console.log(`[ai-analyze] compose content length: ${composeContent.length} chars`);

    // ── Step 2: Parse per-service blocks from compose YAML ───────────────────
    // Returns { containerName: { buildDir, ports[] } }
    function parseComposeServices(yaml) {
      const parsed = {};
      const servicesIdx = yaml.search(/^services\s*:/m);
      if (servicesIdx === -1) return parsed;

      // Slice from services: to next top-level key (no leading spaces)
      const afterServices = yaml.slice(servicesIdx + yaml.slice(servicesIdx).indexOf('\n') + 1);
      const stopIdx = afterServices.search(/^[a-zA-Z0-9]/m);
      const servicesYaml = stopIdx !== -1 ? afterServices.slice(0, stopIdx) : afterServices;

      // Split into service blocks by finding 2-space indented keys at the top level of the block
      const serviceHeaderRe = /^  ([a-zA-Z0-9_][a-zA-Z0-9_-]*):/gm;
      const headers = [];
      let hm;
      while ((hm = serviceHeaderRe.exec(servicesYaml)) !== null) {
        headers.push({ name: hm[1], start: hm.index, end: hm.index + hm[0].length });
      }

      for (let hi = 0; hi < headers.length; hi++) {
        const h = headers[hi];
        const blockStart = h.end;
        const blockEnd = hi + 1 < headers.length ? headers[hi + 1].start : servicesYaml.length;
        const block = servicesYaml.slice(blockStart, blockEnd);

        // container_name (falls back to service key)
        const cnMatch = block.match(/container_name:\s*([a-zA-Z0-9._-]+)/);
        const containerName = cnMatch ? cnMatch[1].trim() : h.name;

        // build context — handle both "build: ./dir" and "build:\n  context: ./dir"
        let buildDir = '';
        const buildLineMatch = block.match(/build:\s*(\S+)/);
        if (buildLineMatch) {
          const buildVal = buildLineMatch[1].trim();
          // If the value itself is "context:" or just a colon it's a block form
          if (buildVal !== 'context:' && buildVal !== '|' && buildVal !== '>') {
            buildDir = buildVal.replace(/^\.\//, '');
          }
        }
        // Override with explicit context: if found inside a build block
        const contextMatch = block.match(/context:\s*(\S+)/);
        if (contextMatch) {
          buildDir = contextMatch[1].trim().replace(/^\.\//, '');
        }

        // ports — collect all "- HOST:CONTAINER" or "- PORT" entries
        const ports = [];
        const portsSection = block.match(/ports:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/);
        if (portsSection) {
          const portLineRe = /- +['"]?(\d+:\d+|\d+)['"]?/g;
          let pm;
          while ((pm = portLineRe.exec(portsSection[1])) !== null) {
            const p = pm[1];
            ports.push(p.includes(':') ? p : `${p}:${p}`);
          }
        }

        parsed[containerName] = { buildDir, ports };
        console.log(`[ai-analyze] Parsed service: ${h.name} → containerName=${containerName}, buildDir=${buildDir || '(root)'}, ports=[${ports.join(',')}]`);
      }
      return parsed;
    }

    const composeServices = parseComposeServices(composeContent);

    // ── Merge AI LLM detected services ────────────────────────────────────────
    if (parsedResult?.services && Array.isArray(parsedResult.services)) {
      for (const aiSvc of parsedResult.services) {
        if (!aiSvc || !aiSvc.name) continue;
        const name = String(aiSvc.name).trim();
        const buildDir = aiSvc.buildDir ? String(aiSvc.buildDir).trim().replace(/^\.\//, '') : '';
        const port = aiSvc.port ? String(aiSvc.port).trim() : '';

        if (!composeServices[name]) {
          composeServices[name] = { buildDir, ports: port ? [port.includes(':') ? port : `${port}:${port}`] : [] };
        } else {
          if (!composeServices[name].buildDir && buildDir) composeServices[name].buildDir = buildDir;
          if ((!composeServices[name].ports || composeServices[name].ports.length === 0) && port) {
            composeServices[name].ports = [port.includes(':') ? port : `${port}:${port}`];
          }
        }
        console.log(`[ai-analyze] Merged AI LLM service: ${name} -> buildDir=${buildDir}, port=${port}`);
      }
    }

    // ── Step 3: Build services list ───────────────────────────────────────────
    if (Object.keys(composeServices).length > 0) {
      // Filter out common infra-only containers
      const infraRe = /^(db|database|redis|mongo|mysql|postgres|rabbitmq|memcached|elasticsearch|zookeeper|kafka)$/i;
      services = Object.keys(composeServices).filter(s => !infraRe.test(s));
      console.log(`[ai-analyze] Services from compose YAML & AI LLM: ${services.join(', ')}`);
    }


    // Fallback A: container_name grep across full listing
    if (services.length === 0) {
      const cnMatches = normalizedListing.match(/container_name:\s*([a-zA-Z0-9._-]+)/g);
      if (cnMatches) {
        services = Array.from(new Set(cnMatches.map(m => m.replace(/container_name:\s*/, '').trim())));
        console.log(`[ai-analyze] Services from container_name grep: ${services.join(', ')}`);
      }
    }

    // Fallback B: project folder name
    if (services.length === 0) {
      const folderName = resolvedPath.split('/').filter(Boolean).pop() || 'app';
      services = [folderName.toLowerCase().replace(/[^a-z0-9._-]/g, '')];
      console.warn(`[ai-analyze] WARNING: Falling back to folder name: ${services[0]}`);
    } else {
      console.log(`[ai-analyze] Final services: ${services.join(', ')}`);
    }

    // ── Step 3b: Extract Nginx port map as fallback ───────────────────────────
    // Probe already reads nginx conf.d and sites-enabled from the nginx container.
    // Pattern 1: proxy_pass http://autfrontend:3033;
    // Pattern 2: server autfrontend:3033;   (inside upstream block)
    function extractNginxPortMap(listing, svcNames) {
      const nginxPortMap = {};
      const nginxSections = [
        'NGINX CONF.D (from container)',
        'NGINX SITES-ENABLED (from container)',
        'NGINX CONFIG (from container)',
        'NGINX CONFIG (host filesystem)',
      ];
      let nginxContent = '';
      for (const section of nginxSections) {
        const marker = `=== ${section} ===`;
        const idx = listing.indexOf(marker);
        if (idx !== -1) {
          const after = listing.slice(idx + marker.length);  // skip exact marker length
          const nextSection = after.indexOf('\n===');
          const content = (nextSection !== -1 ? after.slice(0, nextSection) : after).trim();
          console.log(`[ai-analyze] Nginx section "${section}" found — ${content.length} chars`);
          nginxContent += content + '\n';
        } else {
          console.log(`[ai-analyze] Nginx section "${section}" NOT found in probe output`);
        }
      }

      if (!nginxContent.trim()) {
        console.warn('[ai-analyze] No Nginx config content extracted from probe. Port detection will be skipped.');
        return nginxPortMap;
      }

      console.log(`[ai-analyze] Total Nginx content: ${nginxContent.length} chars`);
      // Log first 500 chars of nginx content for debugging
      console.log('[ai-analyze] Nginx content preview:', nginxContent.slice(0, 500).replace(/\n/g, '\\n'));

      for (const svc of svcNames) {
        // proxy_pass http://autfrontend:PORT  or  proxy_pass http://autfrontend:PORT/
        const proxyMatch = nginxContent.match(new RegExp(`proxy_pass\\s+https?://${svc}:(\\d+)`, 'i'));
        if (proxyMatch) {
          const p = proxyMatch[1];
          nginxPortMap[svc] = `${p}:${p}`;
          console.log(`[ai-analyze] Nginx port for ${svc}: ${p} (from proxy_pass)`);
          continue;
        }
        // server autfrontend:PORT; (inside upstream block)
        const upstreamMatch = nginxContent.match(new RegExp(`server\\s+${svc}:(\\d+)`, 'i'));
        if (upstreamMatch) {
          const p = upstreamMatch[1];
          nginxPortMap[svc] = `${p}:${p}`;
          console.log(`[ai-analyze] Nginx port for ${svc}: ${p} (from upstream server)`);
          continue;
        }
        console.log(`[ai-analyze] No Nginx port pattern found for: ${svc}`);
      }
      return nginxPortMap;
    }

    const nginxPortMap = extractNginxPortMap(normalizedListing, services);

    // ── Step 4: Generate build + swarm sections ───────────────────────────────
    if (services.length > 0) {
      let buildSection = '';
      const buildTasks = [];
      
      for (const svc of services) {
        const info = composeServices[svc] || {};
        const dir = info.buildDir || '';
        const guessedSubdir = svc.replace(/^aut|^app/i, '').toLowerCase() || svc;

        if (dir) {
          buildTasks.push({ svc, dir });
        } else {
          buildTasks.push({ svc, guessedSubdir });
        }
      }

      // Generate parallel build section
      if (buildTasks.length > 0) {
        buildSection += `
echo "[$(date +%H:%M:%S)] Building ${buildTasks.length} image(s) in parallel..."
`;
        
        // Background build jobs
        for (const task of buildTasks) {
          if (task.dir) {
            buildSection += `
(
  if docker build -t ${task.svc}:latest ./${task.dir}; then
    echo "[$(date +%H:%M:%S)] ✅ ${task.svc} build complete" > /tmp/${task.svc}_build_result
  else
    echo "[$(date +%H:%M:%S)] ❌ ${task.svc} build FAILED" > /tmp/${task.svc}_build_result
    exit 1
  fi
) &
${task.svc.toUpperCase()}_BUILD_PID=$!
`;
          } else {
            buildSection += `
(
  if [ -d "${task.guessedSubdir}" ] && [ -f "${task.guessedSubdir}/Dockerfile" ]; then
    if docker build -t ${task.svc}:latest ./${task.guessedSubdir}; then
      echo "[$(date +%H:%M:%S)] ✅ ${task.svc} build complete" > /tmp/${task.svc}_build_result
    else
      echo "[$(date +%H:%M:%S)] ❌ ${task.svc} build FAILED" > /tmp/${task.svc}_build_result
      exit 1
    fi
  elif [ -f "Dockerfile" ]; then
    if docker build -t ${task.svc}:latest ./; then
      echo "[$(date +%H:%M:%S)] ✅ ${task.svc} build complete" > /tmp/${task.svc}_build_result
    else
      echo "[$(date +%H:%M:%S)] ❌ ${task.svc} build FAILED" > /tmp/${task.svc}_build_result
      exit 1
    fi
  else
    echo "[$(date +%H:%M:%S)] ⚠️  ${task.svc}: No Dockerfile found" > /tmp/${task.svc}_build_result
  fi
) &
${task.svc.toUpperCase()}_BUILD_PID=$!
`;
          }
        }

        // Wait for all builds
        buildSection += `
# Wait for all builds to complete
`;
        for (const task of buildTasks) {
          buildSection += `wait $${task.svc.toUpperCase()}_BUILD_PID
${task.svc.toUpperCase()}_BUILD_EXIT=$?
`;
        }

        // Check results
        for (const task of buildTasks) {
          buildSection += `cat /tmp/${task.svc}_build_result 2>/dev/null
`;
        }

        buildSection += `
# Abort if any build failed
`;
        const exitChecks = buildTasks.map(t => `[ $${t.svc.toUpperCase()}_BUILD_EXIT -ne 0 ]`).join(' || ');
        buildSection += `if ${exitChecks}; then
  echo "[deploy] ERROR: One or more builds failed — aborting."
  rm -f ${buildTasks.map(t => `/tmp/${t.svc}_build_result`).join(' ')}
  exit 1
fi
rm -f ${buildTasks.map(t => `/tmp/${t.svc}_build_result`).join(' ')}
echo "[$(date +%H:%M:%S)] ✅ All builds complete"
`;
      }

      let svcSection = '';
      for (const svc of services) {
        const info = composeServices[svc] || {};
        const port = (info.ports && info.ports[0]) ? info.ports[0] : (nginxPortMap[svc] || '');
        if (port) {
          console.log(`[ai-analyze] ${svc}: using port ${port}`);
        } else {
          console.log(`[ai-analyze] ${svc}: no port found — overlay network only`);
        }
        svcSection += `deploy_service ${svc} ${svc}:latest ${port || ''}\n`;
      }

      swarmBlock = `
# set -e intentionally omitted — docker service update exits non-zero during rollback by design

# ── Swarm init (best-effort) ─────────────────────────────────────────────────
docker swarm init 2>/dev/null || true
docker swarm update --task-history-limit 3 2>/dev/null || true

# ── Overlay network (fast) ──────────────────────────────────────────────────
SWARM_NET=$(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v '^ingress$' | head -1)
if [ -z "$SWARM_NET" ]; then
  SWARM_NET="proxy-net"
  docker network create --driver overlay --attachable "$SWARM_NET" 2>/dev/null || SWARM_NET="swarm-overlay"
  docker network create --driver overlay --attachable "$SWARM_NET" 2>/dev/null || true
  # Quick verify - only wait 3 seconds max
  for _i in {1..3}; do
    SWARM_NET=$(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -v '^ingress$' | head -1)
    [ -n "$SWARM_NET" ] && break
    sleep 1
  done
  if [ -z "$SWARM_NET" ]; then
    echo "[net] ERROR: No overlay network after 3s. Aborting."
    exit 1
  fi
fi
echo "[net] Network: $SWARM_NET"

# ── Build images ─────────────────────────────────────────────────────────────
${buildSection}

# ── Detect swarm mode ────────────────────────────────────────────────────────
_IS_SWARM=0
if docker node ls >/dev/null 2>&1; then
  _IS_SWARM=1
  echo "[deploy] Swarm mode active."
else
  echo "[deploy] No swarm manager — using standalone container mode."
fi

# ── deploy_service <name> <image> <host_port:container_port> ─────────────────
deploy_service() {
  local NAME="$1"
  local IMAGE="$2"
  local PORT="$3"

  echo ""
  echo "===== Deploy $NAME ====="

  if [ "$_IS_SWARM" = "1" ]; then
    # ── SWARM MODE ──
    if docker service inspect "$NAME" >/dev/null 2>&1; then
      echo "[swarm] Updating $NAME..."
      docker service update \\
        --image "$IMAGE" \\
        --force \\
        --update-order start-first \\
        --update-parallelism 2 \\
        --update-delay 0s \\
        --update-monitor 3s \\
        --update-failure-action rollback \\
        --rollback-order start-first \\
        --rollback-parallelism 2 \\
        --rollback-delay 0s \\
        --rollback-monitor 3s \\
        --stop-grace-period 10s \\
        "$NAME" || echo "[swarm] WARNING: $NAME update exited non-zero — checking task state..."
      docker service update --network-add "$SWARM_NET" "$NAME" 2>/dev/null || true
    else
      if docker inspect "$NAME" >/dev/null 2>&1; then
        echo "[swarm] Migrating $NAME: standalone container → Swarm service..."
        docker stop "$NAME" 2>/dev/null || true
        _HAD_CONTAINER=1
      else
        echo "[swarm] Creating fresh Swarm service $NAME..."
        _HAD_CONTAINER=0
      fi
      PUBLISH_FLAG=""
      [ -n "$PORT" ] && PUBLISH_FLAG="--publish $PORT"
      if docker service create \\
        --name "$NAME" \\
        --network "$SWARM_NET" \\
        $PUBLISH_FLAG \\
        --replicas 2 \\
        --detach \\
        --no-resolve-image \\
        --update-order start-first \\
        --update-parallelism 2 \\
        --update-delay 0s \\
        --update-monitor 3s \\
        --update-failure-action rollback \\
        --rollback-order start-first \\
        --rollback-parallelism 2 \\
        --rollback-delay 0s \\
        --rollback-monitor 3s \\
        --stop-grace-period 10s \\
        "$IMAGE"; then
        [ "$_HAD_CONTAINER" = "1" ] && docker rm "$NAME" 2>/dev/null || true
      else
        echo "[swarm] ERROR: Failed to create $NAME."
        [ "$_HAD_CONTAINER" = "1" ] && docker start "$NAME" 2>/dev/null || true
        return 1
      fi
    fi

    echo "[swarm] Waiting for $NAME to be healthy..."
    for _i in $(seq 1 10); do
      _RUNNING=$(docker service ps "$NAME" --filter "desired-state=running" --format '{{.CurrentState}}' 2>/dev/null | grep -c "Running" || echo "0")
      _FAILED=$(docker service ps "$NAME" --filter "desired-state=shutdown" --format '{{.CurrentState}}' 2>/dev/null | grep -c "Failed" || echo "0")
      if [ "$_RUNNING" -ge 1 ] 2>/dev/null; then
        echo "[swarm] $NAME is running ($_RUNNING replica(s) up)."
        return 0
      fi
      if [ "$_FAILED" -ge 3 ] 2>/dev/null; then
        echo "[swarm] ERROR: $NAME has $_FAILED failed tasks — container likely crashing."
        docker service ps "$NAME" --no-trunc 2>/dev/null | tail -5
        return 1
      fi
      echo "[swarm] Waiting for $NAME... ($_i/10)"
      sleep 1
    done
    echo "[swarm] WARNING: $NAME not confirmed after 10s — service may still be converging."
    docker service ps "$NAME" --no-trunc 2>/dev/null | tail -5
    return 0

  else
    # ── STANDALONE MODE ──
    echo "[docker] Deploying $NAME as standalone container..."
    if docker inspect "$NAME" >/dev/null 2>&1; then
      echo "[docker] Stopping and removing existing container $NAME..."
      docker stop "$NAME" 2>/dev/null || true
      docker rm "$NAME" 2>/dev/null || true
    fi
    PORT_FLAG=""
    [ -n "$PORT" ] && PORT_FLAG="-p $PORT"
    if docker run -d --name "$NAME" --restart unless-stopped $PORT_FLAG "$IMAGE"; then
      echo "[docker] $NAME started successfully."
      return 0
    else
      echo "[docker] ERROR: Failed to start $NAME."
      return 1
    fi
  fi
}

# ── Deploy services ──────────────────────────────────────────────────────────
${svcSection}

# ── Reconnect Nginx ───────────────────────────────────────────────────────────
if [ "$_IS_SWARM" = "1" ]; then
  for _net in $(docker network ls --filter driver=overlay --format "{{.Name}}"); do
    docker network connect "$_net" global-nginx 2>/dev/null || docker network connect "$_net" nginx 2>/dev/null || true
  done
fi
docker exec global-nginx nginx -s reload 2>/dev/null || docker restart global-nginx 2>/dev/null || true

# ── Cleanup ───────────────────────────────────────────────────────────────────
docker container prune -f 2>/dev/null || true`;
    } // end service injection


    // Always build standardScript and swarmScript separately
    const standardScript = parsedResult.deployCommand || '';
    let swarmScript = standardScript;

    if (swarmBlock) {
      // The swarmBlock handles: swarm init, overlay network, docker build, deploy_service, nginx reconnect, cleanup.
      // From standardScript we want to keep everything EXCEPT the parts swarmBlock replaces:
      //   - docker build lines (swarmBlock has its own build section)
      //   - docker service / docker stack / docker swarm lines
      //   - docker-compose / docker compose up|down
      //   - docker image prune / docker container prune
      //   - nginx reconnect block
      //   - the final "Deployment completed" echo (we append our own)
      // Everything else (cd, git pull, npm install, export, custom setup) is kept as preamble.
      const skipLine = (line) => {
        const t = line.trim();
        if (!t) return false; // keep blank lines
        return (
          /^docker\s+build\b/.test(t) ||
          /^docker\s+(service|swarm|stack)\s/.test(t) ||
          /^docker(-compose|\s+compose)\s+(up|down)/.test(t) ||
          /^docker\s+(image|container)\s+prune/.test(t) ||
          /^docker\s+(exec|restart)\s+.*nginx/.test(t) ||
          /^docker\s+network\s+connect/.test(t) ||
          /echo\s+"Deployment completed/.test(t) ||
          /echo\s+'Deployment completed/.test(t) ||
          // Skip swarm health-wait loops and SWARM_NET setup that the swarmBlock replaces
          /^SWARM_NET=/.test(t) ||
          /swarm.*overlay|overlay.*swarm/i.test(t)
        );
      };

      // Collect preamble: stop when we hit the first docker build or service line
      // (everything after that point is replaced by swarmBlock)
      const standardLines = standardScript.split('\n');
      const preambleLines = [];
      let hitSwarmSection = false;
      for (const line of standardLines) {
        const t = line.trim();
        if (!hitSwarmSection && (
          /^docker\s+build\b/.test(t) ||
          /^docker\s+(service|swarm|stack)\s/.test(t) ||
          /^docker(-compose|\s+compose)\s+(up|down)/.test(t) ||
          /^SWARM_NET=/.test(t)
        )) {
          hitSwarmSection = true;
        }
        if (!hitSwarmSection && !skipLine(line)) {
          preambleLines.push(line);
        }
      }

      const preamble = preambleLines.join('\n').trimEnd();
      swarmScript = (preamble ? preamble + '\n\n' : '') + swarmBlock + '\n\necho "Deployment completed successfully."';
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
    const savedProjectSetting = await SystemSetting.findOne({ ...resolveUserIdQuery(userId), key: dbKey });
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
