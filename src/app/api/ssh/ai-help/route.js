import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, context, contextPack, connectionName, host, prefs, history } = await req.json();

    if (!prompt || !String(prompt).trim()) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    // Check AI token limit
    let usageInfo = null;
    try {
      await checkAndTrackAiUsage(session.user.email, prompt);
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
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      max_completion_tokens: 220,
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

    if (apiKeys.length === 0 && process.env.GROQ_API_KEY) {
      apiKeys.push(process.env.GROQ_API_KEY);
    }

    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'AI service not configured' }, { status: 500 });
    }

    const safeContext = typeof context === 'string' ? context.slice(-2500) : '';
    const safePack = contextPack && typeof contextPack === 'object' ? contextPack : null;
    const safePrefs = prefs && typeof prefs === 'object' ? prefs : {};
    const preferSudo = !!safePrefs.preferSudo;
    const editor = typeof safePrefs.editor === 'string' ? safePrefs.editor : 'nano';
    const viewer = typeof safePrefs.viewer === 'string' ? safePrefs.viewer : 'cat';

    // Build conversation history (last 2 turns, max 700 chars each)
    const safeHistory = Array.isArray(history) ? history.slice(-2) : [];
    const historyMessages = safeHistory.flatMap(h => {
      const msgs = [];
      if (h.role === 'user' && h.content) msgs.push({ role: 'user', content: String(h.content).slice(0, 700) });
      if (h.role === 'assistant' && h.content) msgs.push({ role: 'assistant', content: String(h.content).slice(0, 700) });
      return msgs;
    });

    const packConnName = safePack?.connectionName || connectionName || '?';
    const packHost = safePack?.host || host || '?';
    const packLastCmd = typeof safePack?.lastCommand === 'string' ? safePack.lastCommand.slice(0, 200) : '';
    const packRecentCmds = Array.isArray(safePack?.recentCommands) ? safePack.recentCommands.slice(-20) : [];
    const packLastError = safePack?.lastError && typeof safePack.lastError === 'object' ? safePack.lastError : null;
    const packTail = typeof safePack?.terminalTail === 'string' ? safePack.terminalTail.slice(-6000) : safeContext;

    const structuredContext = safePack
      ? `Context Pack:
Recent Commands:
${packRecentCmds.length ? packRecentCmds.map((c) => `- ${String(c).slice(0, 200)}`).join('\n') : '(none)'}

Last Command:
${packLastCmd || '(none)'}

Last Error:
${packLastError ? `${String(packLastError.label || 'error')}:\n${String(packLastError.excerpt || '').slice(-800)}` : '(none)'}

Terminal Tail:
${packTail || '(none)'}`
      : `Terminal:\n${safeContext || '(none)'}`;

    const sys = `SSH assistant.
Output XML only: <command>, <explain>, <danger>, <done>, <warn>, <interactive>.
Rules:
- Return exactly 1 next command.
- Prefer safe checks first. Prefer non-destructive checks first.
- If an OS package manager (dnf/yum/apt/apk/pacman/zypper) says "not found" or "no match", consider language ecosystem installs instead of retrying the same command.
  Examples: Node.js tools via npm (e.g. pm2 is commonly installed with "npm i -g pm2"), Python via pip/pipx, Ruby via gem, Rust via cargo.
- Before installing, confirm prerequisites with safe commands (e.g. "command -v node npm pm2", "node -v", "npm -v").
- Use sudo only when needed (respect prefs).
Conn: ${packConnName} (${packHost}) Prefs: sudo=${preferSudo} editor=${editor} viewer=${viewer}
${structuredContext}`;

    const messages = [
      { role: 'system', content: sys },
      ...historyMessages,
      { role: 'user', content: String(prompt) },
    ];

    let answer = null;
    let lastError = null;
    let successfulIndex = -1;

    // Loop through keys starting from currentIndex
    // Try at most apiKeys.length times
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
                    model: aiConfig.model,
                    temperature: aiConfig.temperature,
                    max_completion_tokens: aiConfig.max_completion_tokens,
                    top_p: aiConfig.top_p,
                }),
            });

            if (response.ok) {
                const resData = await response.json();
                answer = resData.choices[0]?.message?.content || '';
                successfulIndex = tryIndex;
                break; // Success!
            } else if (response.status === 429) {
                console.warn(`AI Rate limit hit on key index ${tryIndex}. Rotating...`);
                // Continue loop
            } else {
                const errBody = await response.text().catch(() => '');
                throw new Error(`AI service error (${response.status}): ${errBody.slice(0, 200)}`);
            }
        } catch (err) {
            lastError = err;
            // If it's a rate limit error caught (unlikely with above logic, but safety)
            if (err.message.includes('429')) {
                continue;
            }
            // For network errors or 500s, maybe we should also rotate?
            // User said "if hit rate limit", so strict interpretation implies only 429.
            // But usually rotation handles network hiccups too. I'll stick to logic above: only 429 continues explicitly.
            // However, fetch() throws on network error.
            // I'll be safer: if throw, check if it's 429 related? No, fetch doesn't throw on 429.
            // So if fetch throws (network), I'll abort or maybe try next?
            // Abort for now to strictly follow "hit rate limit".
            break; 
        }
    }

    if (successfulIndex !== -1) {
        // Update DB to start with next key next time (Load balancing)
        // Or keep using successful one? Round-robin suggests next.
        if (apiKeys.length > 1) {
             const nextIndex = (successfulIndex + 1) % apiKeys.length;
             SystemSetting.updateOne(
               { key: 'ai_api_keys' },
               { $set: { 'value.currentIndex': nextIndex } }
             ).catch(err => console.error('Failed to update key index:', err));
        }
        if (session) {
          usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, answer);
        }
        return NextResponse.json({ success: true, answer, usage: usageInfo });
    }
    
    // If we are here, we failed
    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });
  } catch (error) {
    console.error('SSH AI Help Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
