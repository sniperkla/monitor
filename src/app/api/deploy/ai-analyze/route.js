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

    const systemPrompt = `You are a DevOps and Deployment agent. You will analyze a directory listing, standard project configuration files, and any existing deployment script to determine:
1. The project type (e.g., Node.js / React, Python / Django, Docker, Java / Spring Boot, Go, PHP, etc.)
2. Key technologies, dependencies, and frameworks used
3. An optimized shell/bash deployment script/command suitable for production.

CRITICAL DEPLOYMENT SCRIPT RULES:
a) SCRIPT STRUCTURE & BASE PRESERVATION:
   - If an existing deployment script is provided in the user prompt, USE IT AS YOUR PRIMARY BASE REFERENCE.
   - PRESERVE directory navigation steps (e.g., \`cd /path/to/project\`), repository updates (\`git pull\`), custom environment variables, and pre/post deployment hooks.
   - ALWAYS include \`git pull\` (or git fetch) BEFORE building docker images or updating services so the latest code changes are built!
   - Write ONE clean bash script. Place \`#!/bin/bash\` and \`set -e\` ONLY ONCE at the very top of the script. NEVER output nested \`#!/bin/bash\` or \`set -e\` inside \`if/else\` blocks or subshells!

b) DOCKER & DOCKER SWARM SERVICES:
   - If the project uses Docker (docker compose, Dockerfile, or Swarm), follow this pattern:
     1. Start with setup: \`cd <path>\` (if applicable) and \`git pull\` (if git repository).
     2. Define \`SERVICE_NAME\` (derived from project name, e.g. "aut") and \`IMAGE_NAME\` (e.g. "aut:latest").
     3. Check for Swarm service:
        \`\`\`bash
        SWARM_TARGET=$(docker service inspect $SERVICE_NAME >/dev/null 2>&1 && echo "$SERVICE_NAME" || (docker service inspect \${SERVICE_NAME}_service >/dev/null 2>&1 && echo "\${SERVICE_NAME}_service" || echo ""))
        if [ -n "$SWARM_TARGET" ]; then
          echo "Swarm service '$SWARM_TARGET' detected! Building image and triggering zero-downtime rolling update..."
          docker build -t $IMAGE_NAME .
          docker service update --image $IMAGE_NAME --update-order start-first --update-delay 5s $SWARM_TARGET
          docker container prune -f
        else
          echo "Running standard Docker Compose deployment..."
          docker compose up -d --build
          sleep 3
          if docker compose ps | grep -E "Up|running|healthy"; then
            echo "Deployment successful: containers are running"
          else
            echo "Deployment failed: containers did not start correctly. Showing logs:"
            docker compose logs --tail=50
            exit 1
          fi
          docker image prune -f && docker container prune -f
        fi
        \`\`\`
   - Use 'docker compose' (or 'docker-compose' if legacy is specified in existing script).

4. A concise summary of why you recommended this configuration.

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
