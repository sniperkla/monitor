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

    const systemPrompt = `You are a DevOps and Deployment agent. You will analyze a directory listing, standard project configuration files, and an existing deployment script to produce an updated, production-ready script.

CRITICAL INSTRUCTIONS - USE ORIGINAL SCRIPT AS STARTING MATERIAL:
1. PRIMARY REQUIREMENT: If an existing deployment script is provided in the prompt below, YOU MUST USE IT AS YOUR EXACT STARTING MATERIAL / TEMPLATE.
2. PRESERVE ORIGINAL COMMANDS: Keep all original "cd" commands (e.g. \`cd /home/ec2-user/aut/\`), repository updates (\`git pull\`), custom environment setup, echo/log statements (e.g. \`echo "Deployment completed successfully."\`), and cleanup commands (\`docker image prune -f\`).
3. NO DUPLICATE HEADERS: Put \`#!/bin/bash\` and \`set -e\` ONLY ONCE at the very top of the script (lines 1 & 2). Never include nested \`#!/bin/bash\` or \`set -e\` inside \`if/else\` blocks.
4. AUTOMATIC SWARM INITIALIZATION & CREATION:
   - If the project uses Docker (Dockerfile or docker-compose), upgrade the deployment section to AUTOMATICALLY create or update Docker Swarm services.

5. MULTI-CONTAINER / MULTI-SERVICE PROJECTS:
   - If docker-compose.yml defines multiple services with container_name (e.g. "autfrontend" and "autbackend"):
   - Do NOT use docker stack deploy (it rejects container_name and external bridge networks).
   - Instead, create or update individual Swarm services for EACH container name defined in docker-compose.yml:

     # Ensure Swarm is active and task history limit is set to 1
     docker swarm init 2>/dev/null || true
     docker swarm update --task-history-limit 1 2>/dev/null || true

     # Build latest images for all services
     docker compose build 2>/dev/null || docker-compose build 2>/dev/null || true

     # Target exact container names from docker-compose.yml
     SERVICES=("autfrontend" "autbackend")

     for SVC in "\${SERVICES[@]}"; do
       IMAGE_NAME=\$(docker inspect --format='{{.Config.Image}}' \$SVC 2>/dev/null || echo "\${SVC}:latest")
       
       # Extract published ports for this service from compose or container inspect (e.g. --publish 3090:3090)
       PORT_FLAGS=""
       if [ "\$SVC" = "autfrontend" ]; then PORT_FLAGS="--publish 3090:3090"; fi
       if [ "\$SVC" = "autbackend" ]; then PORT_FLAGS="--publish 3033:3033"; fi

       SWARM_TARGET=\$(docker service inspect \$SVC >/dev/null 2>&1 && echo "\$SVC" || echo "")

       if [ -n "\$SWARM_TARGET" ]; then
         echo "🐝 Swarm service '\$SWARM_TARGET' found! Updating service zero-downtime..."
         docker service update --image "\$IMAGE_NAME" --update-order start-first --update-delay 5s \$SWARM_TARGET
       else
         echo "🐝 Creating new Swarm service '\$SVC'..."
         # Stop & remove old non-swarm standalone container to free container name and ports
         if docker ps -a --format '{{.Names}}' | grep -w "\$SVC" >/dev/null 2>&1; then
           docker stop \$SVC 2>/dev/null || true
           docker rm \$SVC 2>/dev/null || true
         fi
         # Create Swarm service using exact container name and published ports
         docker service create --name \$SVC \$PORT_FLAGS --detach=true --no-resolve-image --replicas 2 \$IMAGE_NAME || docker compose up -d --build
       fi
     done

     # Automatically connect Nginx proxy to Swarm overlay network so container names resolve cleanly
     NETS=\$(docker network ls --filter driver=overlay --format "{{.Name}}")
     for net in \$NETS; do
       docker network connect \$net global-nginx 2>/dev/null || docker network connect \$net nginx 2>/dev/null || true
     done
     docker restart global-nginx 2>/dev/null || docker exec global-nginx nginx -s reload 2>/dev/null || docker restart nginx 2>/dev/null || true

     docker container prune -f 2>/dev/null || true

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

    // Save configuration inside system settings: value.aiProfile & value.aiLogs
    const existing = await SystemSetting.findOne({ key: dbKey });
    const existingValue = existing?.value || {};

    const aiProfile = {
      projectType: parsedResult.projectType,
      technologies: parsedResult.technologies,
      deployCommand: parsedResult.deployCommand,
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
