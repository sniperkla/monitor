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

    const extractCooldownMap = globalThis.__sshMemoryExtractCooldownMap || (globalThis.__sshMemoryExtractCooldownMap = new Map());

    const { searchParams } = new URL(req.url);
    const streamRequested = searchParams.get('stream') === '1';

    const body = await req.json();
    const { prompt, context, connectionName, host, prefs, history, model, contextPack } = body;
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
    const enforcePatch = safePrefs.enforcePatch !== false;
    const editor = typeof safePrefs.editor === 'string' ? safePrefs.editor : 'nano';
    const viewer = typeof safePrefs.viewer === 'string' ? safePrefs.viewer : 'cat';

    const normalizeAiXml = (xml) => {
      let s = String(xml || '');
      if (!s) return s;

      // Smart Diff Sanitizer: AI often emits "unified diffs" that are slightly malformed 
      // (e.g. context lines missing the leading space).
      if (aiTask === 'code' && enforcePatch) {
        // 1. Basic character repairs
        s = s.replace(/^[\t ]*\+-(.*)$/gm, '+$1');
        s = s.replace(/^[\t ]*-\+(.*)$/gm, '-$1');

        // 2. Structural Hunk Repair: Ensure every line inside <diff> hunk starting from @@ has a valid prefix
        s = s.replace(/<diff>([\s\S]*?)<\/diff>/gi, (match, diffContent) => {
          let inHunk = false;
          const lines = diffContent.split('\n');
          const repairedLines = lines.map(line => {
            const trimmed = line.trim();
            if (line.startsWith('@@')) { inHunk = true; return line; }
            if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ') || line.startsWith('index ')) {
              inHunk = false;
              return line;
            }
            if (!inHunk || trimmed === '') return line;
            
            // If inside hunk and line doesn't start with space, +, -, or \, force a space prefix
            if (!/^[ +\-\\@]/.test(line)) {
              return ' ' + line;
            }
            return line;
          });
          return `<diff>\n${repairedLines.join('\n')}\n</diff>`;
        });
      }

      if (aiTask !== 'code' || !enforcePatch) return s;

      const hasDone = /<done>\s*true\s*<\/done>/i.test(s);
      const hasDiff = /<diff>\s*[\s\S]*?\S[\s\S]*?<\/diff>/i.test(s);
      // In patch-first code mode, model must not declare done unless it proposed a diff.
      if (hasDone && !hasDiff) {
        return s.replace(/<done>\s*true\s*<\/done>/ig, '<done>false</done>');
      }
      return s;
    };

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
    const codeEditorSys = `You are an expert Linux systems engineer and code editor operating via SSH. Your task is to solve problems intelligently and efficiently.

ENV: u=${packUser} h=${packHostname} cwd=${packCwd}

${memBlock}CRITICAL THINKING FRAMEWORK:
1. ANALYZE: Understand the problem completely before acting. What is broken? What needs to change?
2. PLAN: Create a clear, logical sequence of steps. Consider dependencies between steps.
3. EXECUTE: Take action with surgical precision. Use the right tool for the job.
4. VERIFY: Confirm the fix works. Check for side effects. Validate the solution.
5. DOCUMENT: Summarize what was done and why.

OUTPUT XML FORMAT (STRICT):
<thought>
Problem Analysis: What exactly is the issue?
Current State: What does the system look like now?
Target State: What should it look like when fixed?
Approach: How will you solve this? (direct edit, config change, service restart, etc)
Risk Assessment: What could go wrong? How will you prevent it?
</thought>
<plan>
Step-by-step checklist with clear dependencies:
1. [ ] Analyze/Read current state (REQUIRED first step for any file edit)
2. [ ] Backup existing file if it exists
3. [ ] Make the necessary changes
4. [ ] Verify the changes are correct
5. [ ] Restart/reload services if needed
Mark steps as DONE when complete. Only check off after verification.
</plan>
<diff>A unified diff patch (preferred for ALL edits). This is the VSCode-like workflow.
The patch MUST be valid unified diff format using either:
- --- /path/to/file +++ /path/to/file (RECOMMENDED; use absolute paths, applied with -d /)
- or --- a/path +++ b/path (traditional git style, will be attempted with -p1)
Include @@ hunks and only the minimal required changes. Preserve unrelated code.</diff>
<command>Optional non-edit command ONLY for reading/verifying (cat/grep/test). MUST NOT modify files. Leave empty when providing a <diff>.</command>
<explain>One conversational sentence with emoji describing what you're doing and why. Be specific about the file/change.</explain>
<danger>true|false</danger><done>true|false</done>

ADVANCED RULES FOR INTELLIGENT PROBLEM SOLVING:

FILE EDITING MASTERY:
- ALWAYS READ FIRST: Before editing ANY file, you MUST read it first with cat/head/tail to understand its structure
- BACKUP STRATEGY: Always backup files before major changes: cp file file.bak.$(date +%s)
- VALIDATION MANDATORY: After every edit, verify with: cat file | grep -A2 -B2 'changed_section'
- DIFF REQUIRED: After every file edit, output a unified diff so the user can see exactly what changed.
  * If you created a backup: diff -u file.bak.TIMESTAMP file || true
  * If no backup available but in a git repo: git diff -- file || true
- PRESERVE EXISTING CODE: Never replace an entire file unless the user explicitly asks for a full rewrite.
${enforcePatch ? `- PATCH-FIRST (VSCode): For ANY file change, you MUST output a <diff> patch. Do NOT output write commands.
  Forbidden in <command>: sed -i, perl -pi, cat > file, tee file, printf > file, echo > file, mv temp file, redirect (>) writes.
  Allowed in <command>: read/verify only (cat/head/tail/grep/test).
  If the user asks to "apply" immediately, still output <diff>; the UI applies it.
  Only return <command> for read/verify steps.` : `- LEGACY EDITING: You may use surgical edit commands (sed -i / python3 -c) when needed.
  Still prefer minimal changes and always include a unified diff after edits.`}
 - DIFF MUST BE PATCHABLE: Inside @@ hunks, EVERY line must start with one of:
   * space for context lines
   * + for additions
   * - for deletions
   Do NOT emit raw text lines without a prefix (this causes "malformed patch").
- ESCAPE HANDLING: For special characters in sed, use: sed -i 's|pattern|replacement|g' (pipe delimiter avoids escaping slashes)
- HEREDOC SAFETY: Always use <<'EOF' (single quotes) to prevent variable expansion

JSON EDITING (Use python3, never raw text):
python3 -c "
import json
with open('file.json', 'r') as f:
    data = json.load(f)
data['key'] = 'value'
with open('file.json', 'w') as f:
    json.dump(data, f, indent=2)
"

CONFIG FILES:
- INI files: Use python3 configparser or sed with section awareness
- YAML: Use python3 with PyYAML if available, otherwise sed for simple changes
- TOML: Use sed for simple key=value changes, python3 tomllib for complex edits
- Environment files: sed -i 's/^KEY=.*/KEY=newvalue/' .env

DEBUGGING & DIAGNOSTICS:
- Check service status: systemctl status servicename --no-pager
- View recent logs: journalctl -u servicename -n 50 --no-pager
- Test configs BEFORE reload: nginx -t, apachectl configtest, sshd -t
- Check syntax: bash -n script.sh, python3 -m py_compile script.py

ERROR RECOVERY STRATEGIES:
If a command fails, analyze the error and choose the correct recovery path:
1. "Permission denied" → Use sudo or check file ownership (ls -la)
2. "No such file or directory" → Check path exists (ls -la dirname/)
3. "Already exists" → Remove first or use force flag if safe
4. "Syntax error" → Fix the syntax issue, don't just retry
5. "Service failed" → Check logs: journalctl -xe --no-pager | tail -30
6. "Port already in use" → Check: lsof -i :PORT or ss -tlnp | grep PORT

SELF-CORRECTION PROTOCOL:
When you encounter errors:
1. STOP and ANALYZE the error message carefully
2. IDENTIFY the root cause (wrong path? missing dep? syntax error?)
3. ADJUST your approach based on the specific error
4. TRY a different method if the first one failed
5. VERIFY the fix before marking done

ANTI-PATTERNS TO AVOID:
- ❌ Don't use echo with >> to append to config files (creates duplicates)
- ❌ Don't restart services unless you verified config is valid first
- ❌ Don't assume paths - always verify with pwd, which, or ls
- ❌ Don't ignore error output - parse it and respond intelligently
- ❌ Don't modify files without reading them first
- ❌ Don't set done=true until you've verified the fix works

COMPLEX SCENARIOS:
- Multiple file changes: Complete ALL edits, then verify ALL, then restart services
- Service dependencies: Start/restart in correct order (database before app)
- Network configs: Always have a rollback plan before changing network settings
- Database migrations: Backup before schema changes

BE FRIENDLY & PROFESSIONAL: Use emojis in explanations:
🔍 = Analyzing/investigating
📝 = Reading/writing files  
💾 = Saving/creating files
🔧 = Fixing/patching
✅ = Verified working
🚀 = Completed successfully
⚠️ = Warning/caution
🔄 = Retrying/alternative approach
${structuredContext}`;

    // ── SSH COMMAND MODE (default) ────────────────────────────────────────────
    const sshCommandSys = `You are an expert Linux systems engineer solving problems via SSH. Think like a senior SRE/DevOps engineer.

ENV: u=${packUser} h=${packHostname} cwd=${packCwd} sudo=${preferSudo}

${memBlock}PROBLEM-SOLVING METHODOLOGY:
1. GATHER INTEL: Understand the current state before acting
2. FORM HYPOTHESIS: What is likely causing the issue?
3. TEST HYPOTHESIS: Run targeted diagnostics to confirm
4. EXECUTE FIX: Apply the solution with precision
5. VERIFY OUTCOME: Confirm the problem is resolved
6. CLEAN UP: Remove any temporary files or test data

OUTPUT XML FORMAT (STRICT):
<thought>
Situation Assessment: What do we know? What's the current state?
Hypothesis: What do you think is wrong and why?
Plan of Attack: How will you solve this step by step?
Verification Strategy: How will you confirm success?
</thought>
<plan>
Clear checklist with dependencies marked:
1. [ ] Gather information/diagnose
2. [ ] Formulate solution
3. [ ] Execute fix
4. [ ] Verify resolution
5. [ ] Final cleanup
Mark steps complete ONLY after verification.
</plan>
<command>Single shell command that makes progress. Options:
- Diagnostic: ls, ps, netstat, systemctl status, journalctl, grep in logs
- Package mgmt: apt/dnf/apk install, npm/pip install
- File ops: cat, grep, find, stat, test -f
- Service mgmt: systemctl start/stop/restart/status
- Process mgmt: pkill, kill, pgrep
- Network: curl, wget, ping, nc, ss
- [Wait] - when process is still running
- [Ctrl+C] - to stop a running process
- y/yes - to answer interactive prompts only</command>
<explain>One sentence with emoji explaining your reasoning and action. Be specific about what you're checking or fixing.</explain>
<danger>true|false</danger><done>true|false</done><interactive>password|sudo_password|passphrase|confirm_yn|confirm_overwrite|generic</interactive>

COMMAND INTELLIGENCE:

DIAGNOSTIC COMMANDS (Use these FIRST when investigating):
- systemctl status SERVICE --no-pager | head -20: Check service state
- journalctl -u SERVICE -n 50 --no-pager: View recent service logs
- tail -50 /var/log/syslog | grep -i ERROR: System errors
- ps aux | grep -E 'PROCESS|PID' | grep -v grep: Check if process running
- netstat -tlnp | grep :PORT or ss -tlnp | grep :PORT: Check port usage
- df -h: Check disk space issues
- free -m: Check memory
- curl -s http://localhost:PORT/health: Test if service responds

PACKAGE MANAGEMENT:
- DEBIAN/UBUNTU: apt-get update && apt-get install -y PKG
- RHEL/CENTOS/FEDORA: dnf install -y PKG or yum install -y PKG
- ALPINE: apk add --no-cache PKG
- NODE: npm install -g PKG or npx CMD
- PYTHON: pip3 install PKG

SERVICE MANAGEMENT:
- Start: systemctl start SERVICE
- Stop: systemctl stop SERVICE
- Restart: systemctl restart SERVICE
- Reload (config): systemctl reload SERVICE (preferred if available)
- Enable autostart: systemctl enable SERVICE
- Check config: nginx -t, apachectl configtest, sshd -t

PROCESS HANDLING:
- Find process: pgrep -a PROCESS or ps aux | grep PROCESS
- Kill gracefully: kill -TERM PID (wait 5s)
- Force kill: kill -9 PID (last resort)
- Kill all: pkill -f PROCESS_NAME

ERROR ANALYSIS & RECOVERY:
When you see errors, classify and respond:

1. "Permission denied" → Check user: whoami, id. Try sudo. Check permissions: ls -la FILE
2. "No such file or directory" → Verify path: ls -la DIR/, find / -name FILE 2>/dev/null
3. "Address already in use" → Find process: lsof -i :PORT, then decide if kill or reconfigure
4. "Connection refused" → Check if service running: systemctl status SERVICE, check port binding
5. "Syntax error" in configs → Check with: nginx -t, python3 -m py_compile FILE, bash -n SCRIPT
6. "Out of memory" → Check: free -m, dmesg | tail -20, consider adding swap or reducing processes
7. "Disk full" → Check: df -h, find large files: du -h / | sort -rh | head -20
8. "Timeout" → Check network, firewall, DNS: ping, dig, nc -zv HOST PORT

SELF-CORRECTION HIERARCHY:
If your command fails, escalate through these approaches:
Level 1: Fix obvious issue (typo, wrong path, missing sudo)
Level 2: Try alternative command (e.g., dnf instead of yum, ss instead of netstat)
Level 3: Gather more diagnostic data to understand root cause
Level 4: Try completely different approach to achieve the same goal
Level 5: Ask for clarification if truly stuck after 3 attempts

SMART COMMAND PATTERNS:

Chain commands safely with &&:
- cd /path && ls -la (only ls if cd succeeded)
- make config && make && make install

Conditional execution:
- test -f file && echo exists || echo missing
- systemctl is-active --quiet service && echo running || echo stopped

Capture and analyze output:
- CMD 2>&1 | tee /tmp/output.log && grep -q SUCCESS /tmp/output.log

Safe file operations:
- cp important.conf important.conf.bak.$(date +%s) before editing
- test -w file || sudo chown $USER file (check writability first)

INTERACTIVE PROMPT HANDLING:
When you see prompts like:
- "(y/n)" or "[Y/n]" → Send: y
- "Password:" → Send the password (system will prompt user if needed)
- "[sudo] password for" → Send password or mark as sudo_password
- "Are you sure?" → Usually means it's dangerous - set <danger>true</danger>

WAIT PROTOCOL (CRITICAL):
After sending ANY command:
1. If you see output flowing (progress bars, logs) → Send [Wait]
2. If you see a shell prompt ($ or #) → Ready for next command
3. If you see "(END)" or pager prompt → Send q to quit
4. If you see "(y/n)" prompt → Send y or n
5. NEVER send multiple commands while one is still running

SIGNAL HANDLING:
- [Ctrl+C] = Send SIGINT (\x03) - for interactive programs, ping, etc
- Use for: ping, top, tail -f, hung commands, infinite loops

VERIFICATION MANDATE:
You MUST verify every fix:
- File edits: cat file | grep -C3 changed_part
- Service starts: systemctl is-active SERVICE
- Package installs: which CMD || CMD --version
- Config changes: CONFIG_CMD -t (syntax test)
- Network changes: curl/nc test to verify connectivity

TOKEN EFFICIENCY:
- Use concise, precise commands
- Prefer single pipeline over multiple commands
- Use head/tail to limit output
- Avoid cat | grep when grep FILE works

PROFESSIONAL COMMUNICATION:
Use emojis to convey status:
🔍 Diagnosing/Investigating
📊 Checking status/metrics
📦 Installing packages
🔧 Applying fixes
✅ Verified working
🚀 Task completed
🔄 Retrying with alternative
⚠️ Warning/needs attention
❌ Failed/encountered error
💡 Suggestion/Tip
${structuredContext}`;

    const sys = aiTask === 'code' ? codeEditorSys : sshCommandSys;


    const messages = [
      { role: 'system', content: sys },
      ...historyMessages,
      { role: 'user', content: String(prompt) },
    ];

    const maybeRetryForMissingDiff = async (answerText, currentModel, apiKey, extraInfo) => {
      try {
        if (aiTask !== 'code') return null;
        if (!enforcePatch) return null;
        const s = String(answerText || '');
        const hasDiff = /<diff>\s*[\s\S]*?\S[\s\S]*?<\/diff>/i.test(s);
        if (hasDiff) return null;

        const retryUserMsg = `Your last response did NOT include a <diff>. In PATCH-FIRST code mode you MUST output a unified diff patch.
OUTPUT REQUIREMENTS (STRICT):
- Return ONLY valid XML with a non-empty <diff> tag.
- Leave <command> empty.
- The <diff> MUST be a valid unified diff and MUST NOT use leading '/' absolute paths in ---/+++ headers.
  Use safe paths like: home/ubuntu/.zeroclaw/workspace/FILE.md (the UI applies patch with -d /).
- Do NOT re-read files again. Use the context you already have.
Now output the <diff> needed to complete the request.`;

        const retryMessages = [
          ...messages,
          { role: 'assistant', content: String(answerText || '') },
          { role: 'user', content: retryUserMsg },
        ];

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: retryMessages,
            model: currentModel,
            temperature: aiConfig.temperature,
            max_completion_tokens: aiConfig.max_completion_tokens,
            top_p: aiConfig.top_p,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.warn('[AI retry missing diff] Retry request failed:', res.status, errBody.slice(0, 200), extraInfo);
          return null;
        }
        const out = await res.json();
        const retryAnswer = out?.choices?.[0]?.message?.content || '';
        return retryAnswer ? String(retryAnswer) : null;
      } catch (e) {
        console.warn('[AI retry missing diff] Retry failed:', e?.message || e, extraInfo);
        return null;
      }
    };

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

    // If streaming is requested, we do a single attempt (no key/model rotation mid-stream).
    // If it fails, we fall back to the normal non-stream response logic.
    if (streamRequested && mainModel !== 'manual') {
      const chosenApiKey = apiKeys[currentIndex] || apiKeys[0];
      if (!chosenApiKey) {
        return NextResponse.json({ success: false, error: 'Missing AI API key.' }, { status: 400 });
      }

      try {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let full = '';
            let usedModel = mainModel;
            try {
              controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ model: usedModel })}\n\n`));

              const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${chosenApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  messages,
                  model: mainModel,
                  temperature: aiConfig.temperature,
                  max_completion_tokens: aiConfig.max_completion_tokens,
                  top_p: aiConfig.top_p,
                  stream: true,
                }),
              });

              if (!response.ok || !response.body) {
                const errBody = await response.text().catch(() => '');
                throw new Error(`AI service error (${response.status}): ${errBody.slice(0, 200)}`);
              }

              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buf = '';

              while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buf += decoder.decode(value, { stream: true });
                const parts = buf.split(/\n\n/);
                buf = parts.pop() || '';

                for (const part of parts) {
                  const lines = part.split(/\n/).map(l => l.trim()).filter(Boolean);
                  for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const data = line.slice(5).trim();
                    if (data === '[DONE]') {
                      break;
                    }
                    try {
                      const parsed = JSON.parse(data);
                      const delta = parsed.choices?.[0]?.delta?.content;
                      if (delta) {
                        full += delta;
                        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: delta })}\n\n`));
                      }
                    } catch {
                      // ignore malformed chunk
                    }
                  }
                }
              }

              // Finalize: track usage, persist history, trigger memory extraction, then send final payload
              let usageInfo = null;
              usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, full);

              try {
                const missionTitle = contextPack?.goal || prompt.slice(0, 50);
                const oneHourAgo = new Date(Date.now() - 3600000);
                let historyRecord = await AiHistory.findOne({
                  userId: session.user.email,
                  type: 'terminal',
                  title: missionTitle,
                  updatedAt: { $gt: oneHourAgo }
                });

                const newMessagePair = [
                  { role: 'user', content: prompt, timestamp: new Date() },
                  { role: 'assistant', content: full, metadata: { usedModel }, timestamp: new Date() }
                ];

                if (historyRecord) {
                  await AiHistory.updateOne(
                    { _id: historyRecord._id },
                    { $push: { messages: { $each: newMessagePair } }, $set: { lastActive: new Date() } }
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

              try {
                full = normalizeAiXml(full);
                try {
                  const retry = await maybeRetryForMissingDiff(full, usedModel, chosenApiKey, { streamRequested: true, model: usedModel });
                  if (retry) {
                    full = normalizeAiXml(retry);
                  }
                } catch {}
                const doneTagRe = /<done>\s*true\s*<\/done>/i;
                const diffTagRe = /<diff>[\s\S]*?<\/diff>/i;
                const hasCompletion = doneTagRe.test(full) || (aiTask === 'code' && diffTagRe.test(full));
                if (host && hasCompletion && apiKeys.length > 0 && usedModel !== 'manual') {
                  const cooldownKey = `${session.user.email}::${host}`;
                  const now = Date.now();
                  const lastAt = extractCooldownMap.get(cooldownKey) || 0;
                  if (now - lastAt < 60000) {
                    console.log('[SSH Memory] Skipping extraction (cooldown) for host:', host);
                  } else {
                    extractCooldownMap.set(cooldownKey, now);
                  const extractFacts = async (uri) => {
                    try {
                      const db = await connectDB(uri);
                      const SshMemory = getSshMemoryModel(db);
                      await SshMemory.findOneAndUpdate(
                        { userId: session.user.email, host },
                        { $set: { lastSeenAt: new Date() }, $inc: { sessionCount: 1 } },
                        { upsert: true }
                      );
                    } catch (err) {
                      console.error('[SSH Memory] Fact extraction failed:', err);
                    }
                  };
                  extractFacts(customerDbUri);
                  }
                }
              } catch (err) {
                console.error('[SSH Memory] Streaming done handling failed:', err);
              }

              controller.enqueue(encoder.encode(`event: final\ndata: ${JSON.stringify({ success: true, answer: full, usedModel: usedModel, usage: usageInfo })}\n\n`));
              controller.close();
            } catch (err) {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ success: false, error: err?.message || 'Streaming failed' })}\n\n`));
              controller.close();
            }
          }
        });

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        });
      } catch (err) {
        console.error('Streaming request failed, falling back:', err);
      }
    }

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

                    try {
                      answer = normalizeAiXml(answer);
                      const retry = await maybeRetryForMissingDiff(answer, currentModel, apiKey, { streamRequested, tryIndex, currentModel });
                      if (retry) {
                        answer = normalizeAiXml(retry);
                      }
                    } catch {}

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
          answer = normalizeAiXml(answer);
          const doneTagRe = /<done>\s*true\s*<\/done>/i;
          const diffTagRe = /<diff>[\s\S]*?<\/diff>/i;
          const hasCompletion = doneTagRe.test(answer) || (aiTask === 'code' && diffTagRe.test(answer));
          if (host && hasCompletion && apiKeys.length > 0 && actualUsedModel !== 'manual') {
            const cooldownKey = `${session.user.email}::${host}`;
            const now = Date.now();
            const lastAt = extractCooldownMap.get(cooldownKey) || 0;
            if (now - lastAt < 60000) {
              console.log('[SSH Memory] Skipping extraction (cooldown) for host:', host);
              return NextResponse.json({ success: true, answer, usage: usageInfo, usedModel: actualUsedModel });
            }
            extractCooldownMap.set(cooldownKey, now);
            console.log('[SSH Memory] Triggering fact extraction for host:', host);
            const extractFacts = async (uri) => {
              try {
                const db = await connectDB(uri);
                const SshMemory = getSshMemoryModel(db);
                
                // First, always update session count and lastSeenAt when done
                await SshMemory.findOneAndUpdate(
                  { userId: session.user.email, host },
                  { 
                    $set: { lastSeenAt: new Date() },
                    $inc: { sessionCount: 1 }
                  },
                  { upsert: true }
                );
                console.log('[SSH Memory] Updated session count for:', host);
                
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

                console.log('[SSH Memory] Calling extraction AI...');
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
                  const factsText = out.choices[0]?.message?.content || '{}';
                  console.log('[SSH Memory] Extraction AI response:', factsText);
                  
                  let facts = {};
                  try {
                    facts = JSON.parse(factsText);
                  } catch (parseErr) {
                    console.error('[SSH Memory] Failed to parse extraction JSON:', parseErr);
                    return;
                  }
                  
                  // Build update payload
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
                  
                  const result = await SshMemory.findOneAndUpdate(
                    { userId: session.user.email, host },
                    updatePayload,
                    { upsert: true, new: true }
                  );
                  console.log('[SSH Memory] Successfully updated facts for:', host, 'Fields:', Object.keys(setFields).join(', '));
                } else {
                  const errText = await res.text().catch(() => 'unknown error');
                  console.error('[SSH Memory] Extraction AI failed:', res.status, errText);
                }
              } catch (err) {
                console.error('[SSH Memory] Fact extraction failed:', err);
              }
            };
            
            // Fire and forget
            extractFacts(customerDbUri);
          } else {
            if (host) {
              console.log('[SSH Memory] Skipping extraction. Conditions:', {
                hasDone: doneTagRe.test(answer),
                hasDiff: diffTagRe.test(answer),
                aiTask,
                hasApiKeys: apiKeys.length > 0,
                isNotManual: actualUsedModel !== 'manual'
              });
            }
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
