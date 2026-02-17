import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ai:ssh:${clientIP}`, 30);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        },
        { status: 429 }
      );
    }

    const { prompt, context, connectionName, host, prefs, history } = await req.json();

    if (!prompt || !String(prompt).trim()) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    await connectDB();

    let apiKeys = [];
    let currentIndex = 0;
    let aiConfig = {
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      max_completion_tokens: 600,
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

    const safeContext = typeof context === 'string' ? context.slice(-10000) : '';
    const safePrefs = prefs && typeof prefs === 'object' ? prefs : {};
    const preferSudo = !!safePrefs.preferSudo;
    const editor = typeof safePrefs.editor === 'string' ? safePrefs.editor : 'nano';
    const viewer = typeof safePrefs.viewer === 'string' ? safePrefs.viewer : 'cat';

    // Build conversation history (last 6 turns, max 1000 chars each)
    const safeHistory = Array.isArray(history) ? history.slice(-6) : [];
    const historyMessages = safeHistory.flatMap(h => {
      const msgs = [];
      if (h.role === 'user' && h.content) msgs.push({ role: 'user', content: String(h.content).slice(0, 1000) });
      if (h.role === 'assistant' && h.content) msgs.push({ role: 'assistant', content: String(h.content).slice(0, 1000) });
      return msgs;
    });

    const sys = `Role: Expert SSH Shell Assistant.
Goal: Accomplish user tasks on REMOTE servers. SUGGEST commands only.

ENV:
- Conn: ${connectionName || '?'} (${host || '?'})
- Prefs: sudo=${preferSudo}, editor=${editor}, viewer=${viewer}
- Terminal:
${safeContext || '(none)'}

RULES:
1. ONE command per response.
2. XML output:
   <thought>reasoning</thought>
   <command>shell command</command>
   <explain>brief explanation</explain>
   <danger>true|false (true if destructive: rm, mkfs, fdisk, kill)</danger>
   <done>true|false (true ONLY if goal PROVEN done in output)</done>
   <warn>optional warning</warn>
   <interactive>input type (password|y/n|passphrase|editor)</interactive>

3. SAFETY:
   - READ-ONLY (safe): ls, cat, grep, systemctl status.
   - MODIFY: apt/yum install, systemctl start.
   - DANGER (<danger>true</danger>): rm, kill, stop services. Pause for these.

4. LOGIC:
   - Detect OS via output (apt=Debian, yum=RHEL, apk=Alpine).
   - Install: Check existing first (which/rpm/dpkg). If missing, install.
   - Service: Use --now with enable. Firewalld: --permanent + --reload.
   - Interactive: Set <interactive> tag. Auto-confirm installs (-y).
   - Secrets: NEVER ask/print secrets.
   - Multi-step: Use history. Don't repeat successful commands. Fix errors.
   - Files: Use ${viewer}/${editor}. Avoid interactive editors in auto-mode.

5. ERROR HANDLING:
   - "not found" -> install/check path.
   - "permission denied" -> sudo/check perms.
   - "in use" -> check ports (lsof/ss).`;

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
        return NextResponse.json({ success: true, answer });
    }
    
    // If we are here, we failed
    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });
  } catch (error) {
    console.error('SSH AI Help Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
