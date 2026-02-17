import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

import { checkRateLimit } from '@/lib/serverGuard';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ai:ssh:${clientIP}`, 20);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        },
        { status: 429 }
      );
    }

    const { prompt, context, connectionName, host, prefs } = await req.json();

    if (!prompt || !String(prompt).trim()) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'AI service not configured (Missing API Key)' },
        { status: 500 }
      );
    }

    const safeContext = typeof context === 'string' ? context.slice(-12000) : '';
    const safePrefs = prefs && typeof prefs === 'object' ? prefs : {};
    const preferSudo = !!safePrefs.preferSudo;
    const editor = typeof safePrefs.editor === 'string' ? safePrefs.editor : 'nano';
    const viewer = typeof safePrefs.viewer === 'string' ? safePrefs.viewer : 'cat';

    const sys = `You are an expert Linux/Unix shell assistant for SSH sessions. Your job is to help the user remember the correct command.

CONTEXT:
- Connection: ${connectionName || 'unknown'}
- Host: ${host || 'unknown'}
- User Preferences:
  - preferSudo: ${preferSudo}
  - editor: ${editor} (use for editing files)
  - viewer: ${viewer} (use for viewing files)
- Last terminal output (may contain errors):\n${safeContext || '(none)'}

STRICT RULES:
1) NEVER execute anything. Only suggest commands.
2) Prefer safe, read-only inspection commands first (ls, cat, tail, less, grep, find, du, df, ps).
3) When the user wants to view a file, prefer the user's viewer (${viewer}) unless it is not suitable (e.g., binary/large file -> use less).
4) When the user wants to edit a file, prefer the user's editor (${editor}). Consider safer options like sudoedit for protected files.
5) If the user asks for a destructive operation (rm, mv, chmod, chown, truncate, dd, mkfs, systemctl restart, kill), provide:
   - a safe preview command first
   - then the destructive command
   - clearly mark it as DANGEROUS
6) Do not request or reveal secrets. If a command would require passwords/keys, explain at high level.
7) If preferSudo is true and the user hits permission denied for system paths (/etc, /var/log, /root), suggest using sudo (or sudoedit) as appropriate.

OUTPUT FORMAT (exactly):
<thought>brief reasoning</thought>
<command>shell command(s) only</command>
<explain>1-3 sentences explanation</explain>
<danger>true|false</danger>
<warn>(optional)short warning</warn>`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: String(prompt) },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        max_completion_tokens: 700,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to connect to AI service');
    }

    const resData = await response.json();
    const fullContent = resData.choices[0]?.message?.content || '';

    return NextResponse.json({ success: true, answer: fullContent });
  } catch (error) {
    console.error('SSH AI Help Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
