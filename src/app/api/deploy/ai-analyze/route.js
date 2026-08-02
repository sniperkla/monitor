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

    if (targetType === 'local') {
      const cmd = `cd "${resolvedPath}" && ls -la && cat package.json 2>/dev/null && cat docker-compose.yml 2>/dev/null && cat Dockerfile 2>/dev/null && cat requirements.txt 2>/dev/null && cat pyproject.toml 2>/dev/null && cat pom.xml 2>/dev/null && cat build.gradle 2>/dev/null && echo "=== DOCKER COMPOSE VERSION ===" && (docker compose version 2>/dev/null || docker-compose --version 2>/dev/null)`;
      filesListing = await new Promise((resolve) => {
        exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
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
          const sshCmd = `cd "${resolvedPath}" && ls -la && cat package.json 2>/dev/null && cat docker-compose.yml 2>/dev/null && cat Dockerfile 2>/dev/null && cat requirements.txt 2>/dev/null && cat pyproject.toml 2>/dev/null && cat pom.xml 2>/dev/null && cat build.gradle 2>/dev/null && echo "=== DOCKER COMPOSE VERSION ===" && (docker compose version 2>/dev/null || docker-compose --version 2>/dev/null)`;
          conn.exec(sshCmd, { timeout: 30000 }, (err, stream) => {
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
    const isSwarmMode = /docker\s+(swarm|service|stack)/.test(existingScript) || existingScript.includes('AUTO-INJECTED SWARM SECTION');

    const systemPrompt = `You are a DevOps and Deployment agent. You will analyze a directory listing, standard project configuration files, and an existing deployment script to produce an updated, production-ready script.

CRITICAL INSTRUCTIONS - USE ORIGINAL SCRIPT AS STARTING MATERIAL:
1. PRIMARY REQUIREMENT: If an existing deployment script is provided in the prompt below, YOU MUST USE IT AS YOUR EXACT STARTING MATERIAL / TEMPLATE.
2. PRESERVE ORIGINAL COMMANDS: Keep all original "cd" commands (e.g. \`cd /home/ec2-user/aut/\`), repository updates (\`git pull\`), custom environment setup, echo/log statements (e.g. \`echo "Deployment completed successfully."\`), and cleanup commands (\`docker image prune -f\`).
3. NO DUPLICATE HEADERS: Put \`#!/bin/bash\` and \`set -e\` ONLY ONCE at the very top of the script (lines 1 & 2). Never include nested \`#!/bin/bash\` or \`set -e\` inside \`if/else\` blocks.
4. DOCKER BUILD ONLY: If the project uses Docker, keep the original docker build or docker-compose build commands. Do NOT add any docker service, docker swarm, or docker stack commands — those will be injected automatically by the system if needed.
5. END THE SCRIPT with the original echo completion message and image prune if present.
6. FRESH SETUP: If no existing script is provided, generate a standard docker-compose based deployment script that uses \`docker compose up -d --build\` (or \`docker-compose up -d --build\`). Do NOT add Swarm commands.

You MUST respond with a valid JSON object ONLY. Do not wrap the JSON in markdown formatting blocks or include any extra text. The JSON format must be EXACTLY:
{
  "projectType": "Name of project type",
  "technologies": ["tech1", "tech2", "tech3"],
  "deployCommand": "string representing shell script with newlines",
  "summary": "Concise summary of recommendations and analysis"
}`;

    const userPrompt = `Here is the scanned directory listing and config files content for the project path "${resolvedPath}":\n\n${filesListing}\n\nExisting deployment script (USE AS BASELINE REFERENCE to preserve cd, git pull, etc.):\n${existingScript || '# No previous script set'}`;

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
    // Extract service names from docker-compose.yml (container_name OR service definitions under `services:`)
    let swarmBlock = '';
    let services = [];

    // 1. Try matching explicit container_name entries
    const composeContainerNames = filesListing.match(/container_name:\s*(\S+)/g);
    if (composeContainerNames && composeContainerNames.length > 0) {
      services = composeContainerNames.map(m => m.replace('container_name:', '').trim());
    } else {
      // 2. Try matching top-level service block keys under services:
      const servicesSectionMatch = filesListing.match(/services:\s*\n((?:\s{2,4}[a-zA-Z0-9._-]+:\s*\n[\s\S]*?)+)(?=\n\S|\n$)/);
      if (servicesSectionMatch) {
        const serviceKeys = servicesSectionMatch[1].match(/^\s{2,4}([a-zA-Z0-9._-]+):/gm);
        if (serviceKeys) {
          services = serviceKeys.map(k => k.trim().replace(':', ''));
        }
      }
    }

    // 3. Fallback: project folder name if docker-compose.yml missing or couldn't parse
    if (services.length === 0) {
      const folderName = resolvedPath.split('/').filter(Boolean).pop() || 'app';
      services = [folderName.toLowerCase().replace(/[^a-z0-9._-]/g, '')];
    }

    if (services.length > 0) {
      // Detect subfolder build contexts from docker-compose.yml (build: ./frontend etc)
      const buildLines = filesListing.match(/build:\s*(\S+)/g) || [];
      const buildDirs = buildLines.map(b => b.replace('build:', '').trim().replace(/^\.\//,''));

      // Detect ports per container: scan each container_name or service block for its ports
      const portMap = {};
      for (const svc of services) {
        // Find host:container port patterns near this service name
        const svcPortMatch = filesListing.match(new RegExp(`(?:container_name:|${svc}:)[\\s\\S]{0,400}?ports:[\\s\\S]{0,200}?-(\\s*['"]?\\d+:\\d+['"]?)`, 'm'));
        if (svcPortMatch) {
          const portLine = svcPortMatch[1].trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
          portMap[svc] = portLine;
        }
      }

      let buildSection = '';
      for (let i = 0; i < services.length; i++) {
        const svc = services[i];
        const dir = buildDirs[i] || '';
        // Strip project prefix for subfolder guess (e.g. autfrontend -> frontend, autbackend -> backend)
        const subdir = dir || svc.replace(/^aut/, '').replace(/^app/, '');
        buildSection += `
     # Build image for ${svc}
     if [ -d "${subdir}" ] && [ -f "${subdir}/Dockerfile" ]; then
       echo "Building ${svc}:latest from ./${subdir}..."
       docker build -t ${svc}:latest ./${subdir}
     fi`;
      }

      let svcSection = '';
      for (const svc of services) {
        const port = portMap[svc] || '';
        const publishFlag = port ? `--publish ${port}` : '';
        svcSection += `

     # ------ ${svc} ------
     if docker service inspect ${svc} >/dev/null 2>&1; then
       echo "Updating Swarm service ${svc} zero-downtime..."
       docker service update --image ${svc}:latest --network-add proxy-net --update-order start-first --update-delay 5s ${svc}
     else
       echo "Creating new Swarm service ${svc}..."
       docker stop ${svc} 2>/dev/null || true
       docker rm ${svc} 2>/dev/null || true
       docker service create --name ${svc} --network proxy-net ${publishFlag} --detach=true --no-resolve-image --replicas 2 ${svc}:latest
     fi`;
      }

      swarmBlock = `
     # === AUTO-INJECTED SWARM SECTION ===
     docker swarm init 2>/dev/null || true
     docker swarm update --task-history-limit 1 2>/dev/null || true

     # Ensure attachable overlay network proxy-net exists for Nginx DNS
     if [ "$(docker network inspect proxy-net --format '{{.Driver}}' 2>/dev/null)" != "overlay" ]; then
       echo "🌐 Ensuring proxy-net is an attachable overlay network..."
       docker network rm proxy-net 2>/dev/null || true
       docker network create --driver overlay --attachable proxy-net 2>/dev/null || true
     fi
${buildSection}
     # Fallback compose build
     docker compose build 2>/dev/null || docker-compose build 2>/dev/null || true
${svcSection}

     # Reconnect Nginx to Swarm overlay networks
     NETS=$(docker network ls --filter driver=overlay --format "{{.Name}}")
     for net in $NETS; do
       docker network connect $net global-nginx 2>/dev/null || docker network connect $net nginx 2>/dev/null || true
     done
     docker exec global-nginx nginx -s reload 2>/dev/null || docker restart global-nginx 2>/dev/null || true

     docker container prune -f 2>/dev/null || true
     # === END SWARM SECTION ===`;
    } // end isSwarmMode

    // Always build standardScript and swarmScript separately
    const standardScript = parsedResult.deployCommand || '';
    let swarmScript = standardScript;

    if (swarmBlock) {
      // Remove any swarm/stack/service commands the AI may have written
      let cleanScript = standardScript.replace(/docker\s+(swarm|service|stack)\s+[^\n]*/g, '# [swarm commands replaced by injected section]');
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

    // Save configuration inside system settings: value.aiProfile & value.aiLogs
    const existing = await SystemSetting.findOne({ key: dbKey });
    const existingValue = existing?.value || {};

    const aiProfile = {
      projectType: parsedResult.projectType,
      technologies: parsedResult.technologies,
      deployCommand: finalScript,
      standardScript,
      swarmScript,
      summary: parsedResult.summary,
      analyzedAt: new Date()
    };

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
