import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import AiHistory from '@/models/AiHistory';
import { getSshMemoryModel } from '@/models/SshMemory';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, context, contextPack, connectionName, host, prefs, history, model } = await req.json();
    const customerDbUri = req.headers.get('x-mongodb-uri');

    if (!prompt || !String(prompt).trim()) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    // Check AI token limit (include context for accurate estimate)
    try {
      await checkAndTrackAiUsage(session.user.email, prompt, '', context || '');
    } catch (limitErr) {
      return NextResponse.json({ success: false, error: limitErr.message }, { status: 429 });
    }

    const limitsSetting = await SystemSetting.findOne({ key: 'ai_limits' });
    const limitsValue = limitsSetting?.value && typeof limitsSetting.value === 'object' ? limitsSetting.value : {};
    const rateValue = limitsValue?.rate && typeof limitsValue.rate === 'object' ? limitsValue.rate : {};
    const sshPerMinute = Number.isFinite(Number(rateValue.sshPerMinute)) ? Math.max(1, Number(rateValue.sshPerMinute)) : 30;

    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ai:ssh:${clientIP}`, sshPerMinute);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        },
        { status: 429 }
      );
    }

    await connectDB();

    let apiKeys = [];
    let currentIndex = 0;
    let aiConfig = {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0.1,
      max_completion_tokens: 4096,
      top_p: 0.9,
    };

    try {
      const keysSetting = await SystemSetting.findOne({ key: 'ai_api_keys' });
      if (keysSetting && keysSetting.value && Array.isArray(keysSetting.value.keys) && keysSetting.value.keys.length > 0) {
        apiKeys = keysSetting.value.keys;
        currentIndex = keysSetting.value.currentIndex || 0;
      }

      const configSetting = await SystemSetting.findOne({ key: 'ai_config' });
      if (configSetting && configSetting.value) {
        aiConfig = { ...aiConfig, ...configSetting.value };
      }
    } catch (e) {
      console.error('Error fetching AI settings from DB:', e);
    }
    
    // Override with user selection if provided
    if (model && typeof model === 'string') {
        aiConfig.model = model;
    }

    if (apiKeys.length === 0 && process.env.GROQ_API_KEY) {
      apiKeys.push(process.env.GROQ_API_KEY);
    }

    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'AI service not configured' }, { status: 500 });
    }

    const safeContext = typeof context === 'string' ? context.slice(-2000) : '';
    const safePack = contextPack && typeof contextPack === 'object' ? contextPack : null;
    const safePrefs = prefs && typeof prefs === 'object' ? prefs : {};
    const preferSudo = !!safePrefs.preferSudo;
    const editor = typeof safePrefs.editor === 'string' ? safePrefs.editor : 'nano';
    const viewer = typeof safePrefs.viewer === 'string' ? safePrefs.viewer : 'cat';

    // Keep history tight — 2 turns (last 2 actions) is plenty with the rich prompt
    const safeHistory = Array.isArray(history) ? history.slice(-2) : [];
    const historyMessages = safeHistory.flatMap(h => {
      const msgs = [];
      if (h.role === 'user' && h.content) msgs.push({ role: 'user', content: String(h.content).slice(0, 400) });
      if (h.role === 'assistant' && h.content) {
        // For assistant messages, only keep the command tag to save tokens
        const cmdMatch = String(h.content).match(/<command>([\s\S]*?)<\/command>/i);
        const doneMatch = String(h.content).match(/<done>(true|false)<\/done>/i);
        const brief = cmdMatch ? `CMD:${cmdMatch[1].trim()}${doneMatch?.[1]==='true'?' DONE':''}` : String(h.content).slice(0, 150);
        msgs.push({ role: 'assistant', content: brief });
      }
      return msgs;
    });

    const packConnName = safePack?.connectionName || connectionName || '?';
    const packHost = safePack?.host || host || '?';
    const packLastCmd = typeof safePack?.lastCommand === 'string' ? safePack.lastCommand.slice(0, 200) : '';
    const packRecentCmds = Array.isArray(safePack?.recentCommands) ? safePack.recentCommands.slice(-5) : [];
    const packLastError = safePack?.lastError && typeof safePack.lastError === 'object' ? safePack.lastError : null;
    // Use only 1200 chars of terminal tail — enough for context, not wasteful
    const packTail = typeof safePack?.terminalTail === 'string' ? safePack.terminalTail.slice(-1200) : safeContext;

    const structuredContext = safePack
      ? `CTX:
Cmds:${packRecentCmds.length ? packRecentCmds.map(c => String(c).slice(0, 100)).join(' | ') : 'none'}
Last:${packLastCmd || 'none'}
Err:${packLastError ? `${packLastError.label}: ${String(packLastError.excerpt||'').slice(-300)}` : 'none'}
Output:
${packTail || 'none'}`
      : `Output:
${safeContext || 'none'}`;

    const packUser = safePack?.user || 'unknown';
    const packCwd = safePack?.cwd || 'unknown';
    const packHostname = safePack?.hostname || packHost;

    const aiTask = typeof safePrefs.aiTask === 'string' ? safePrefs.aiTask : 'ssh';

    // ── LOAD SSH MEMORY ──────────────────────────────────────────────────────
    const db = await connectDB(customerDbUri);
    const SshMemory = getSshMemoryModel(db);

    let memBlock = '';
    let memoryDoc = null;
    try {
      if (host) {
        memoryDoc = await SshMemory.findOne({ userId: session.user.email, host }).lean();
        if (memoryDoc) {
          const lines = ['[SERVER MEMORY FACTS]'];
          if (memoryDoc.os) lines.push(`- OS: ${memoryDoc.os}`);
          if (memoryDoc.loginUser) lines.push(`- User: ${memoryDoc.loginUser}`);
          if (memoryDoc.packageManager) lines.push(`- PkgMgr: ${memoryDoc.packageManager}`);
          if (memoryDoc.workingDir) lines.push(`- WorkDir: ${memoryDoc.workingDir}`);
          if (memoryDoc.installedTools?.length) lines.push(`- Tools: ${memoryDoc.installedTools.join(', ')}`);
          if (memoryDoc.runningServices?.length) lines.push(`- Services: ${memoryDoc.runningServices.join(', ')}`);
          if (memoryDoc.keyPaths?.length) lines.push(`- Paths: ${memoryDoc.keyPaths.join(', ')}`);
          if (memoryDoc.completedGoals?.length) {
            lines.push(`- Past Goals:`);
            memoryDoc.completedGoals.slice(-3).forEach(g => lines.push(`  * ${g.goal} (${g.summary})`));
          }
          if (memoryDoc.notes?.length) {
            lines.push(`- Notes:`);
            memoryDoc.notes.slice(-3).forEach(n => lines.push(`  * ${n.content}`));
          }
          if (lines.length > 1) {
            memBlock = lines.join('\n') + '\n\n';
          }
        }
      }
    } catch (e) {
      console.error('Failed to load SshMemory:', e);
    }

    // ── CODE / FILE EDITOR MODE ──────────────────────────────────────────────
    const codeEditorSys = `Expert Code & File Editor AI operating on a remote Linux server via SSH.
ENV: u=${packUser} h=${packHostname} cwd=${packCwd}

${memBlock}You help edit, fix, or create any kind of file on the remote server — JSON, TOML, YAML, Python scripts, shell scripts, agent skills, config files, etc.

OUTPUT XML:
<thought>Brief analysis of what needs to change and why</thought>
<plan>1–3 clear steps to accomplish the edit</plan>
<command>A SINGLE complete shell command that writes/patches the file (use printf, cat <<'EOF', tee, sed -i, python3 -c, or jq). Never use interactive editors (nano/vim).</command>
<explain>One short conversational sentence describing your action (e.g. "I'll update the config file now," or "Let me fix that JSON syntax error.")</explain>
<danger>true|false</danger><done>true|false</done>

RULES FOR CODE/FILE EDITING:
- JSON: Use "python3 -c" or "jq" to safely patch JSON. NEVER write raw JSON with cat<<EOF if it has special characters; use python3 -c "import json,sys; d=json.load(open('path')); d['key']='val'; json.dump(d,open('path','w'),indent=2)" instead.
- TOML / YAML: Use sed -i or python3 with tomllib/pyyaml.
- Shell scripts / Python: Use printf '%s\n' or cat <<'HEREDOC' > file to write multi-line content safely.
- Agent/Skill files (Zeroclaw, etc): Read the file FIRST (cat/python3 print) to understand structure, then patch the specific section. You have full control.
- Always VERIFY: After writing, cat the modified section back to confirm correctness. Set <done>true</done> only when verified.
- DIFF APPROACH: For large files, prefer surgical sed -i or python3 patch over full rewrites.
- NO LOOPING: If you have already read a file once, do NOT read it again unless you just changed it. Prioritize ACTION (patching) over repetitive checking.
- ENCODING: Never use &lt; &gt; — use raw characters.
- If user says "fix the JSON", first cat the file to see the problem, then patch.
- SELF-CORRECT: If your last command errored, analyze the output and try a completely different approach.
${structuredContext}`;

    // ── SSH COMMAND MODE (default) ────────────────────────────────────────────
    const sshCommandSys = `Autonomous Linux AI. Achieve goal via SSH. No questions.
ENV: u=${packUser} h=${packHostname} cwd=${packCwd} sudo=${preferSudo}

${memBlock}OUTPUT XML:
<thought>Brief Analysis</thought>
<plan>1-3 NEXT steps</plan>
<command>1 shell command or [Wait] or [Ctrl+C]</command>
<explain>1 short conversational sentence (e.g. "Let me check the logs", "Ah, I found the issue!", "I'll install that now.")</explain>
<danger>true|false</danger><done>true|false</done><interactive>type</interactive>
RULES:
- Continuous commands (ping, top) MUST use count/limit flags (e.g. ping -c 4).
- If process running (no prompt), next command must be [Wait] or [Ctrl+C].
- CURSOR/PROMPT: You MUST wait for the shell prompt ($ or #) before sending a new command. If you see active output (installing logs, progress bars) but NO prompt, send [Wait].
- TOKEN CONSERVATION: Do NOT send new commands while a process is RUNNING. Only proceed when the prompt is returned.
- SMART COMMANDS: 
  * Use "ls -F" or "ls -la" to see file types/permissions.
  * Use "grep -C 3" to see context around errors.
  * Use "df -h" or "free -m" if you suspect resource issues.
  * Prefill answers for interactive tools (e.g., DEBIAN_FRONTEND=noninteractive).
- SUDO: If a command fails with "Permission denied", use "sudo !!" or prepend "sudo ".
- VERIFICATION: You MUST check the result of your last command. If it produced an error, failed to create a file, or didn't start a service, FIX IT immediately. Do NOT ignore errors or skip to the next step until the current one is successful.
- ANTI-LOOP: If a service is clearly RUNNING or a file is clearly CREATED, set <done>true</done>. DO NOT "double check" unless it's a safety requirement.
- CONTEXT: If user says "continue", it means "Finish the task based on HISTORY". Review the last 5 steps to resume progress.
- NO EDITORS: Never use nano, vim, or vi. Use "cat <<EOF > file" or "sed -i".
- NO HTML ENCODING: Always send RAW terminal characters. Never use &lt or &gt in <command>.
- NPM/NPX ERRORS: If "npx create-next-app" fails with "Could not locate repository", it means the template/example path is invalid. Try again WITHOUT the example flag or use a simpler official template.
- ZEROCLAW: If asked to adjust Zeroclaw (.zeroclaw), do NOT get stuck in a loop checking files. Identify the target skill/agent/config, patch it (sed/python/printf), and verify. You have full control.
- NO LOOPING: If you have already read a file once, do NOT read it again unless you just changed it. Prioritize ACTION (patching) over repetitive checking.
- SELF-CORRECTION: If you see "error", "canceled", or "syntax error", analyze the cause and try a COMPLETELY different approach immediately.
- INTERACTIVE PROMPTS: If you see "(y/n)", "(y)", or similar questions ending the output, send exactly "y" or "yes" as the <command>. Do NOT send a full shell command until the prompt is resolved.
- PROJECT NAME: If prompted for a project name, use the default or a simple name like "my-app".
${structuredContext}`;

    const sys = aiTask === 'code' ? codeEditorSys : sshCommandSys;


    const messages = [
      { role: 'system', content: sys },
      ...historyMessages,
      { role: 'user', content: String(prompt) },
    ];

    let answer = null;
    let lastError = null;
    let successfulIndex = -1;

    // Models to try
    const determineBestModel = () => {
        if (model === 'manual') return 'manual';
        if (model && model !== 'auto') return model;
        
        const text = (prompt + ' ' + (context || '')).toLowerCase();
        const isLong = text.length > 4000;
        const isComplex = /(install|setup|configure|debug|optimize|fail|error|architecture)/.test(text);
        
        if (isLong || (isComplex && text.length > 2000)) {
            return 'llama-3.3-70b-versatile';
        }
        if (isComplex || text.length > 1000) {
            return 'meta-llama/llama-4-scout-17b-16e-instruct';
        }
        return 'llama-3.1-8b-instant';
    };

    const mainModel = determineBestModel();
    let fallbackModel = mainModel;
    if (mainModel !== 'manual') {
        fallbackModel = mainModel === 'llama-3.1-8b-instant' 
            ? 'meta-llama/llama-4-scout-17b-16e-instruct' 
            : 'llama-3.3-70b-versatile';
    }
        
    const modelsToTry = [mainModel];
    if (mainModel !== 'manual' && mainModel !== fallbackModel) modelsToTry.push(fallbackModel);
    
    // Add Llama 3.3 70B as a final fallback if not already in the list
    if (mainModel !== 'manual' && !modelsToTry.includes('llama-3.3-70b-versatile')) {
        modelsToTry.push('llama-3.3-70b-versatile');
    }

    let actualUsedModel = mainModel;

    // Loop through models, then through keys
    for (const currentModel of modelsToTry) {
        if (currentModel === 'manual') {
            const manualEndpoint = prefs?.aiEndpoint || 'https://api.openai.com/v1/chat/completions';
            const manualApiKey = prefs?.aiApiKey;
            const customModel = prefs?.aiCustomModel || 'gpt-3.5-turbo';

            if (!manualApiKey) {
                lastError = new Error('Manual AI service: Missing API Key in settings');
                break;
            }

            try {
                const response = await fetch(manualEndpoint, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${manualApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messages,
                        model: customModel,
                        temperature: aiConfig.temperature,
                        max_completion_tokens: aiConfig.max_completion_tokens,
                        top_p: aiConfig.top_p,
                    }),
                });

                if (response.ok) {
                    const resData = await response.json();
                    answer = resData.choices[0]?.message?.content || '';
                    successfulIndex = 999; // bypass index update
                    actualUsedModel = customModel;
                    break;
                } else if (response.status === 429) {
                    lastError = new Error('Manual AI service: Rate limit hit.');
                } else {
                    const errBody = await response.text().catch(() => '');
                    lastError = new Error(`Manual AI service error (${response.status}): ${errBody.slice(0, 200)}`);
                }
            } catch (err) {
                lastError = err;
            }
            break; // Stop after manual attempt
        }

        // Loop through keys starting from currentIndex for Groq models
        for (let i = 0; i < apiKeys.length; i++) {
            const tryIndex = (currentIndex + i) % apiKeys.length;
            const apiKey = apiKeys[tryIndex];

            try {
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messages,
                        model: currentModel,
                        temperature: aiConfig.temperature,
                        max_completion_tokens: aiConfig.max_completion_tokens,
                        top_p: aiConfig.top_p,
                    }),
                });

                if (response.ok) {
                    const resData = await response.json();
                    answer = resData.choices[0]?.message?.content || '';
                    successfulIndex = tryIndex;
                    actualUsedModel = currentModel;
                    break;
                } else if (response.status === 429) {
                    console.warn(`AI Rate limit hit on key index ${tryIndex} for model ${currentModel}. Rotating...`);
                } else {
                    const errBody = await response.text().catch(() => '');
                    throw new Error(`AI service error (${response.status}): ${errBody.slice(0, 200)}`);
                }
            } catch (err) {
                lastError = err;
                continue; 
            }
        }
        
        if (successfulIndex !== -1) break;
        console.warn(`All keys failed for model ${currentModel}. Trying next fallback...`);
    }

    if (successfulIndex !== -1) {
        if (apiKeys.length > 1 && successfulIndex !== 999) {
             const nextIndex = (successfulIndex + 1) % apiKeys.length;
             SystemSetting.updateOne(
               { key: 'ai_api_keys' },
               { $set: { 'value.currentIndex': nextIndex } }
             ).catch(e => console.error('Failed to update API key rotation index', e));
        }
        
        let usageInfo = null;
        if (session) {
          usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, answer);
          
          // PERSIST HISTORY
          try {
            const missionTitle = contextPack?.goal || prompt.slice(0, 50);
            
            // Find or update recent mission (within 1 hour)
            const oneHourAgo = new Date(Date.now() - 3600000);
            let historyRecord = await AiHistory.findOne({
              userId: session.user.email,
              type: 'terminal',
              title: missionTitle,
              updatedAt: { $gt: oneHourAgo }
            });

            const newMessagePair = [
              { role: 'user', content: prompt, timestamp: new Date() },
              { role: 'assistant', content: answer, metadata: { usedModel: actualUsedModel }, timestamp: new Date() }
            ];

            if (historyRecord) {
              await AiHistory.updateOne(
                { _id: historyRecord._id },
                { 
                  $push: { messages: { $each: newMessagePair } },
                  $set: { lastActive: new Date() }
                }
              );
            } else {
              await AiHistory.create({
                userId: session.user.email,
                type: 'terminal',
                title: missionTitle,
                context: { connectionName, host, connectionId: contextPack?.connectionId },
                messages: newMessagePair
              });
            }
          } catch (dbErr) {
            console.error('Failed to save AI history:', dbErr);
          }

          // ASYNC KNOWLEDGE EXTRACTION (if done and success)
          // We fire and forget this so it doesn't block the user response
          if (host && /<done>true<\/done>/.test(answer) && apiKeys.length > 0 && actualUsedModel !== 'manual') {
            const extractFacts = async (uri) => {
              try {
                const db = await connectDB(uri);
                const SshMemory = getSshMemoryModel(db);
                // Use the fastest/cheapest model for extraction
                const extractModel = 'llama-3.1-8b-instant';
                const extractApiKey = apiKeys[0]; // grab first key
                
                const cmdMatch = answer.match(/<command>([\s\S]*?)<\/command>/i);
                const explainMatch = answer.match(/<explain>([\s\S]*?)<\/explain>/i);
                
                const sysExtract = `Extract server facts from this newly completed AI task.
Return ONLY a valid JSON object. No markdown, no fuzz.
Fields (all optional):
{
  "os": "Ubuntu 22.04 or Debian etc",
  "packageManager": "apt, brew, yum, etc",
  "installedTools": ["nodejs", "pm2", "nginx"],
  "runningServices": ["zeroclaw", "nginx"],
  "keyPaths": ["/var/www/html", "/home/user/zeroclaw"],
  "completedGoal": { "goal": "what was asked", "summary": "what was done", "stepsCount": 1 }
}
ONLY include fields if you learned them JUST NOW. NEVER invent facts.`;
                
                const userExtractText = `Task Goal: ${prompt}
Command ran: ${cmdMatch ? cmdMatch[1].trim() : '(none)'}
AI Explanation: ${explainMatch ? explainMatch[1].trim() : '(none)'}
Context: ${structuredContext.slice(0, 1500)}`;

                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${extractApiKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messages: [
                      { role: 'system', content: sysExtract },
                      { role: 'user', content: userExtractText }
                    ],
                    model: extractModel,
                    temperature: 0.1,
                    response_format: { type: 'json_object' }
                  })
                });
                
                if (res.ok) {
                  const out = await res.json();
                  const facts = JSON.parse(out.choices[0]?.message?.content || '{}');
                  
                  // Call our local PATCH memory endpoint internally
                  const setFields = { lastSeenAt: new Date() };
                  const addToSetFields = {};
                  const pushFields = {};

                  if (facts.os) setFields.os = facts.os;
                  if (facts.packageManager) setFields.packageManager = facts.packageManager;
                  
                  if (facts.installedTools?.length) addToSetFields.installedTools = { $each: facts.installedTools.slice(0, 10) };
                  if (facts.runningServices?.length) addToSetFields.runningServices = { $each: facts.runningServices.slice(0, 10) };
                  if (facts.keyPaths?.length) addToSetFields.keyPaths = { $each: facts.keyPaths.slice(0, 10) };
                  
                  if (facts.completedGoal?.goal) {
                    pushFields.completedGoals = {
                      $each: [{
                        goal: String(facts.completedGoal.goal).slice(0, 200),
                        summary: String(facts.completedGoal.summary || '').slice(0, 400),
                        stepsCount: Number(facts.completedGoal.stepsCount) || 1,
                        completedAt: new Date(),
                      }],
                      $slice: -20,
                    };
                  }

                  const updatePayload = { $set: setFields };
                  if (Object.keys(addToSetFields).length) updatePayload.$addToSet = addToSetFields;
                  if (Object.keys(pushFields).length) updatePayload.$push = pushFields;
                  
                  await SshMemory.findOneAndUpdate(
                    { userId: session.user.email, host },
                    updatePayload,
                    { upsert: true }
                  );
                }
              } catch (err) {
                console.error('Fact extraction failed silently:', err);
              }
            };
            
            // Fire and forget
            extractFacts(customerDbUri);
          }
        }
        return NextResponse.json({ success: true, answer, usage: usageInfo, usedModel: actualUsedModel });
    }
    
    // If we are here, we failed
    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });
  } catch (error) {
    console.error('SSH AI Help Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
