import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { exec } from 'child_process';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';

// Supported model options
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project') || 'default';
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    const { targetType, connectionId, projectPath, aiModel, aiCustomModel, aiEndpoint: aiEndpointBody, aiApiKey: aiApiKeyBody } = await request.json();

    if (!targetType) {
      return NextResponse.json({ success: false, error: 'Target type is required' }, { status: 400 });
    }

    let filesListing = '';
    const resolvedPath = projectPath?.trim() || '.';

    if (targetType === 'local') {
      // Local Host listing
      const cmd = `cd ${resolvedPath} && ls -la && cat package.json 2>/dev/null && cat docker-compose.yml 2>/dev/null && cat Dockerfile 2>/dev/null && cat requirements.txt 2>/dev/null && cat pyproject.toml 2>/dev/null && cat pom.xml 2>/dev/null && cat build.gradle 2>/dev/null && echo "=== DOCKER COMPOSE VERSION ===" && (docker compose version 2>/dev/null || docker-compose --version 2>/dev/null)`;
      filesListing = await new Promise((resolve) => {
        exec(cmd, (error, stdout, stderr) => {
          resolve(stdout || stderr || 'No files found or unable to scan.');
        });
      });
    } else if (targetType === 'ssh') {
      // Remote SSH Server listing
      if (!connectionId) {
        return NextResponse.json({ success: false, error: 'Connection ID is required for SSH target' }, { status: 400 });
      }

      const db = await connectDB();
      const repo = new ConnectionRepository(db);
      await repo.init();

      const normalizedId = String(connectionId || '').trim();
      if (!normalizedId) {
        return NextResponse.json({ success: false, error: 'SSH connection ID is required for remote analysis.' }, { status: 400 });
      }

      const connection = await repo.findById(normalizedId);
      if (!connection) {
        return NextResponse.json({ success: false, error: `SSH connection with ID ${normalizedId} not found.` }, { status: 400 });
      }

      // Build SSH connection config
      const sshConfig = {
        host: connection.host,
        port: connection.port || 22,
        username: connection.username || 'root',
        readyTimeout: 20000,
      };

      if (connection.authType === 'password') {
        sshConfig.password = decrypt(connection.password);
      } else if (connection.authType === 'privateKey') {
        sshConfig.privateKey = decrypt(connection.privateKey);
        if (connection.passphrase) {
          sshConfig.passphrase = decrypt(connection.passphrase);
        }
      }

      filesListing = await new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
          const sshCmd = `cd ${resolvedPath} && ls -la && cat package.json 2>/dev/null && cat docker-compose.yml 2>/dev/null && cat Dockerfile 2>/dev/null && cat requirements.txt 2>/dev/null && cat pyproject.toml 2>/dev/null && cat pom.xml 2>/dev/null && cat build.gradle 2>/dev/null && echo "=== DOCKER COMPOSE VERSION ===" && (docker compose version 2>/dev/null || docker-compose --version 2>/dev/null)`;
          conn.exec(sshCmd, (err, stream) => {
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

    let apiKey = process.env.GROQ_API_KEY || '';
    if (keysSetting?.value?.keys && Array.isArray(keysSetting.value.keys) && keysSetting.value.keys.length > 0) {
      const idx = keysSetting.value.currentIndex || 0;
      apiKey = keysSetting.value.keys[idx] || keysSetting.value.keys[0];
    }

    let aiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    let modelName = configSetting?.value?.model || FALLBACK_MODEL;
    const effectiveAiModel = aiModel || projectAiPrefs.aiModel;
    const effectiveAiCustomModel = aiCustomModel || projectAiPrefs.aiCustomModel;
    const effectiveAiEndpoint = aiEndpointBody || projectAiPrefs.aiEndpoint;
    const effectiveAiApiKey = aiApiKeyBody || projectAiPrefs.aiApiKey;

    if (effectiveAiModel === 'manual') {
      aiEndpoint = effectiveAiEndpoint || 'https://api.openai.com/v1/chat/completions';
      modelName = effectiveAiCustomModel || 'gpt-3.5-turbo';
      apiKey = effectiveAiApiKey || apiKey;
    } else if (effectiveAiModel && effectiveAiModel !== 'auto') {
      modelName = effectiveAiModel;
    }

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'AI Service API Key is not configured. Enter a custom API key or ensure your global Groq key is set.' }, { status: 400 });
    }

    const aiConfig = {
      model: modelName,
      temperature: 0.1,
      max_tokens: 2048,
      ...configSetting?.value
    };

    const systemPrompt = `You are a DevOps and Deployment agent. You will analyze a directory listing and standard project configuration files (like package.json, requirements.txt, docker-compose.yml, Dockerfile, pom.xml, build.gradle, etc.) to determine:
1. The project type (e.g., Node.js / React, Python / Django, Docker, Java / Spring Boot, Go, PHP, etc.)
2. Key technologies, dependencies, and frameworks used
3. An optimized shell/bash deployment script/command suitable for a production build & run (e.g., git pull && npm run build && pm2 restart app). Include steps like downloading dependencies, running builds, restarting processes/services, or running Docker containers. Include comments explaining key steps. Crucially, always write bash/shell commands safely (e.g. start bash scripts with '#!/bin/bash\nset -e\n' or chain sequential commands with '&&') to ensure that if any intermediate command fails (like a build), the script immediately stops and returns a non-zero exit status to fail the deployment.
   IMPORTANT FOR DOCKER PROJECTS: If the project uses Docker (docker compose, docker-compose, or Dockerfile), follow these rules strictly:
   a) Use 'docker compose' (not 'docker-compose') unless a docker-compose binary is detected.
   b) After 'docker compose up -d', ALWAYS add a verification step using this exact pattern to wait for containers to stabilize before checking status:
      sleep 3
      if docker compose ps | grep -E "Up|running|healthy"; then
        echo "Deployment successful: containers are running"
      else
        echo "Deployment failed: containers did not start correctly. Showing logs:"
        docker compose logs --tail=50
        exit 1
      fi
   c) Do NOT use 'docker ps | grep <name>' for verification because it is fragile. Always use 'docker compose ps' instead.
   d) After successful verification, append the following cleanup step to prevent disk from filling up with dangling images:
      docker image prune -f
4. A concise summary of why you recommended this configuration.

You MUST respond with a valid JSON object ONLY. Do not wrap the JSON in markdown formatting blocks or include any extra text. The JSON format must be EXACTLY:
{
  "projectType": "Name of project type",
  "technologies": ["tech1", "tech2", "tech3"],
  "deployCommand": "string representing shell script with newlines",
  "summary": "Concise summary of recommendations and analysis"
}`;

    const userPrompt = `Here is the scanned directory listing and config files content for the project path "${resolvedPath}":\n\n${filesListing}`;

    // Query Groq API
    let parsedResult = null;
    try {
      const response = await fetch(aiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: aiConfig.model,
          temperature: aiConfig.temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API returned ${response.status}: ${errorText}`);
      }

      const resJson = await response.json();
      const content = resJson.choices?.[0]?.message?.content;
      parsedResult = JSON.parse(content);
    } catch (aiErr) {
      console.error('Groq AI Call failed:', aiErr.message);
      return NextResponse.json({ 
        success: false, 
        error: `AI analysis failed: ${aiErr.message}. Make sure your Groq API key is valid.` 
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
