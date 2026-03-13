import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import { AiHistoryRepository } from '@/lib/repositories/AiHistoryRepository';
import { SshMemoryRepository } from '@/lib/repositories/SshMemoryRepository';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

// Truncate skill content to save tokens (keep most important parts)
const truncateSkill = (content, maxChars = 3000) => {
  if (content.length <= maxChars) return content;
  
  // Try to keep sections: Description, Detection, and first few commands
  const lines = content.split('\n');
  const kept = [];
  let currentSection = '';
  let charCount = 0;
  
  for (const line of lines) {
    // Prioritize headers and important sections
    if (line.startsWith('#') || line.startsWith('## Description') || line.startsWith('## Detection')) {
      currentSection = line;
    }
    
    if (charCount + line.length > maxChars) {
      kept.push('\n... [truncated, see full skill file]');
      break;
    }
    
    kept.push(line);
    charCount += line.length + 1;
  }
  
  return kept.join('\n');
};

// Load skill files from skills directory and SkillsMP .agents/skills directory
async function loadSkills() {
  const skills = [];
  const MAX_SKILL_CHARS = 3000; // ~750 tokens per skill max
  
  // Load from custom skills/ folder (.md files)
  try {
    const skillsDir = join(process.cwd(), 'skills');
    const files = await readdir(skillsDir);
    const skillFiles = files.filter(f => f.endsWith('.md'));
    
    for (const file of skillFiles) {
      try {
        const content = await readFile(join(skillsDir, file), 'utf-8');
        const name = file.replace('.md', '');
        skills.push({ name, content: truncateSkill(content, MAX_SKILL_CHARS), source: 'custom' });
      } catch (e) {
        console.warn(`Failed to load skill ${file}:`, e.message);
      }
    }
  } catch (e) {
    // Skills directory doesn't exist
  }
  
  // Load from SkillsMP .agents/skills/ folder (installed via npx skills add)
  try {
    const skillsMpDir = join(process.cwd(), '.agents', 'skills');
    const entries = await readdir(skillsMpDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const skillPath = join(skillsMpDir, entry.name);
        const skillFiles = (await readdir(skillPath)).filter(f => 
          f === 'SKILL.md' || f === 'skill.md' || f === 'README.md' || f.endsWith('.md')
        );
        
        for (const file of skillFiles) {
          try {
            const content = await readFile(join(skillPath, file), 'utf-8');
            skills.push({ name: entry.name, content: truncateSkill(content, MAX_SKILL_CHARS), source: 'skillsmp' });
            break; // Only load first found skill file per directory
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {
    // .agents/skills directory doesn't exist (SkillsMP not used)
  }
  
  return skills;
}

// Match skills based on prompt keywords
function matchSkills(skills, prompt, context) {
  const promptTextRaw = String(prompt || '').toLowerCase();
  const contextTextRaw = String(context || '').toLowerCase();
  // Context often contains terminal banners, URLs, and unrelated noise.
  // Use prompt-first matching; only use a small, de-noised slice of context as a weak signal.
  const contextText = contextTextRaw
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ' ')
    .slice(-500);
  const promptText = promptTextRaw.replace(/https?:\/\/\S+/g, ' ');
  
  const keywordMap = {
    'firewall-management': ['firewall', 'port', 'ufw', 'firewalld', 'iptables', 'nftables', 'block', 'allow', 'deny'],
    'pm2-deployment': ['pm2', 'deploy', 'start', 'node', 'npm', 'yarn', 'next.js', 'express', 'flask', 'fastapi', 'python app', 'ecosystem'],
    'docker': ['docker', 'container', 'image', 'dockerfile', 'docker-compose', 'dind'],
    'nginx': ['nginx', 'reverse proxy', 'upstream', 'ssl', 'https', 'certificate'],
    'database': ['mysql', 'postgres', 'mongodb', 'redis', 'sql', 'database', 'db'],
    'ssl-certificates': ['ssl', 'tls', 'certificate', 'https', 'letsencrypt', 'certbot', 'openssl'],
    'monitoring': ['monitor', 'prometheus', 'grafana', 'alert', 'metric', 'log'],
    'backup': ['backup', 'restore', 'archive', 'snapshot', 'dump'],
    'security': ['security', 'harden', 'ssh', 'fail2ban', 'rootkit', 'audit', 'permission'],
    'troubleshooting': ['error', 'fail', 'crash', 'debug', 'troubleshoot', 'issue', 'problem', 'not working', 'broken'],
    // SkillsMP installed skills
    'ssh': ['ssh', 'ssh-key', 'ssh-keygen', 'ssh-copy-id', 'authorized_keys', 'sshd', 'remote access', 'key authentication'],
    'git': ['git', 'commit', 'branch', 'merge', 'rebase', 'pull', 'push', 'clone', 'checkout', 'stash', 'cherry-pick', 'git conflict'],
  };
  
  // For some broad skills, require a primary keyword match in the prompt to avoid false positives.
  const primaryKeywords = {
    nginx: ['nginx', 'reverse proxy'],
    'ssl-certificates': ['ssl', 'tls', 'certbot', "let's encrypt", 'letsencrypt', 'certificate'],
    docker: ['docker', 'dockerfile', 'docker compose', 'docker-compose'],
    'pm2-deployment': ['pm2', 'ecosystem', 'deploy'],
    database: ['mysql', 'postgres', 'mongodb', 'redis', 'database'],
  };

  const scoreKeywordHits = (text, keywords) => {
    let hits = 0;
    for (const kw of keywords) {
      if (!kw) continue;
      if (text.includes(kw)) hits += 1;
    }
    return hits;
  };

  const scored = [];
  for (const skill of skills) {
    const skillName = String(skill.name || '').toLowerCase();
    const keywords = keywordMap[skillName] || [];
    const primary = primaryKeywords[skillName] || [];

    const skillNameVariants = [
      skillName,
      skillName.replace(/-/g, ' '),
      skillName.replace(/-/g, ''),
    ].filter(Boolean);

    const nameHitPrompt = skillNameVariants.some(v => v && promptText.includes(v));
    const nameHitContext = skillNameVariants.some(v => v && contextText.includes(v));
    const kwHitsPrompt = scoreKeywordHits(promptText, keywords);
    const kwHitsContext = scoreKeywordHits(contextText, keywords);

    const hasPrimaryInPrompt = primary.length ? primary.some(kw => promptText.includes(kw)) : true;

    // ── NEGATIVE MATCH: Prevent confusing similar product names ──
    // If the prompt mentions a specific product name (e.g. "openclaw") that is NOT
    // this skill's name (e.g. "zeroclaw"), suppress the match even if words overlap.
    // Extract potential product names from prompt: words that look like proper nouns / tool names
    const promptWords = promptText.split(/\s+/).filter(w => w.length > 3);
    let negativePenalty = false;
    for (const pw of promptWords) {
      // Check if the prompt word shares a suffix/root with the skill name but ISN'T the skill name
      // e.g. "openclaw" shares "claw" with "zeroclaw" but they are different products
      const skillRoot = skillName.replace(/[-_]/g, '');
      const pwClean = pw.replace(/[-_]/g, '');
      if (pwClean !== skillRoot && pwClean.length > 4 && skillRoot.length > 4) {
        // Check if they share a common suffix of 4+ chars (e.g. "claw")
        const minLen = Math.min(pwClean.length, skillRoot.length);
        let commonSuffix = 0;
        for (let ci = 1; ci <= minLen; ci++) {
          if (pwClean[pwClean.length - ci] === skillRoot[skillRoot.length - ci]) commonSuffix++;
          else break;
        }
        if (commonSuffix >= 4 && !promptText.includes(skillRoot)) {
          negativePenalty = true;
          break;
        }
      }
    }

    // Scoring (prompt weighted much higher than context)
    let score = 0;
    if (nameHitPrompt) score += 10;
    if (nameHitContext) score += 2;
    score += kwHitsPrompt * 3;
    score += kwHitsContext * 1;

    // If primary keywords are defined, require prompt primary match.
    if (!hasPrimaryInPrompt) score = 0;
    // If negative product name match, suppress
    if (negativePenalty) score = 0;

    // Threshold to avoid accidental matches (e.g. URLs causing ssl-related hits)
    if (score >= 6) scored.push({ skill, score });
  }

  scored.sort((a, b) => b.score - a.score);
  // Cap to reduce token usage and accidental over-matching.
  return scored.slice(0, 3).map(x => x.skill);
}

/**
 * Extracts facts and reminders from AI tags and updates the persistent server brain.
 */
async function handleSshMemoryExtraction(userId, host, answer, goal = '') {
  if (!host || !answer) return null;

  try {
    const db = await connectDB();
    const repo = new SshMemoryRepository(db);
    await repo.init();

    const factMatch = answer.match(/<fact>([\s\S]*?)<\/fact>/i);
    const reminderMatch = answer.match(/<reminder>([\s\S]*?)<\/reminder>/i);
    const doneMatch = answer.match(/<done>\s*true\s*<\/done>/i);

    const facts = {};
    const reminders = [];

    if (factMatch) {
      try {
        const parsed = JSON.parse(factMatch[1].trim());
        Object.assign(facts, parsed);
      } catch (e) {
        console.warn('[SSH Memory] Failed to parse <fact> JSON:', e.message);
      }
    }

    if (reminderMatch) {
      try {
        const parsed = JSON.parse(reminderMatch[1].trim());
        if (parsed.title && parsed.command) {
          reminders.push({
            title: String(parsed.title).slice(0, 100),
            command: String(parsed.command).slice(0, 500),
            category: String(parsed.category || 'general').slice(0, 40),
            addedAt: new Date(),
          });
        }
      } catch (e) {
        console.warn('[SSH Memory] Failed to parse <reminder> JSON:', e.message);
      }
    }

    // Build Mongoose update
    const setFields = { lastSeenAt: new Date() };
    const addToSetFields = {};
    const pushFields = {};

    if (facts.os) setFields.os = String(facts.os).slice(0, 100);
    if (facts.loginUser) setFields.loginUser = String(facts.loginUser).slice(0, 80);
    if (facts.workingDir) setFields.workingDir = String(facts.workingDir).slice(0, 200);
    if (facts.packageManager) setFields.packageManager = String(facts.packageManager).slice(0, 40);

    // Arrays
    if (Array.isArray(facts.keyPaths)) {
      addToSetFields.keyPaths = { $each: facts.keyPaths.map(p => String(p).slice(0, 200)).slice(0, 20) };
    }
    if (Array.isArray(facts.installedTools)) {
      addToSetFields.installedTools = { $each: facts.installedTools.map(t => String(t).slice(0, 80)).slice(0, 30) };
    }
    if (Array.isArray(facts.runningServices)) {
      addToSetFields.runningServices = { $each: facts.runningServices.map(s => String(s).slice(0, 80)).slice(0, 20) };
    }

    // Goal Completion
    if (doneMatch && goal) {
      pushFields.completedGoals = {
        $each: [{
          goal: String(goal).slice(0, 200),
          summary: 'Completed via AI intervention', // Extracting summary from explain tag could be a future improvement
          completedAt: new Date(),
        }],
        $slice: -20,
      };
    }

    // Reminders
    if (reminders.length) {
      // Use $addToSet with $each for reminders if they don't already exist? 
      // Mongoose $addToSet on objects works by exact object match.
      addToSetFields.reminders = { $each: reminders };
    }

    const update = { $set: setFields };
    if (Object.keys(addToSetFields).length) update.$addToSet = addToSetFields;
    if (Object.keys(pushFields).length) update.$push = pushFields;

    await repo.findOneAndUpdate(
      { userId, host },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return true;
  } catch (err) {
    console.error('[SSH Memory] Extraction failed:', err);
    return false;
  }
}

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

    const centralDb = await connectDB();
    const settingsRepo = new SystemSettingRepository(centralDb);
    await settingsRepo.init();
    const limitsSetting = await settingsRepo.findOne({ key: 'ai_limits' });
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


    let apiKeys = [];
    let currentIndex = 0;
    let aiConfig = {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0.1,
      max_completion_tokens: 4096,
      top_p: 0.9,
    };

    try {
      const keysSetting = await settingsRepo.findOne({ key: 'ai_api_keys' });
      if (keysSetting && keysSetting.value && Array.isArray(keysSetting.value.keys) && keysSetting.value.keys.length > 0) {
        apiKeys = keysSetting.value.keys;
        currentIndex = keysSetting.value.currentIndex || 0;
      }

      const configSetting = await settingsRepo.findOne({ key: 'ai_config' });
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
    const autoTmux = !!safePrefs.autoTmux;

    // Load and match skills
    const allSkills = await loadSkills();
    const matchedSkills = matchSkills(allSkills, prompt, context);
    
    // Build skill status info for user visibility
    const skillStatusInfo = {
      totalAvailable: allSkills.length,
      availableSkills: allSkills.map(s => ({ name: s.name, source: s.source })),
      matchedSkills: matchedSkills.map(s => s.name),
      sources: {
        custom: allSkills.filter(s => s.source === 'custom').map(s => s.name),
        skillsmp: allSkills.filter(s => s.source === 'skillsmp').map(s => s.name)
      }
    };
    
    // Log skill status for debugging
    console.log('[Skills] Available:', skillStatusInfo.availableSkills.map(s => `${s.name}(${s.source})`).join(', ') || 'none');
    console.log('[Skills] Matched:', skillStatusInfo.matchedSkills.join(', ') || 'none');
    
    const skillBlock = matchedSkills.length > 0
      ? `\n📚 LOADED SKILLS (${matchedSkills.length} matched from ${allSkills.length} available):\n${matchedSkills.map(s => `--- ${s.name} [${s.source}] ---\n${s.content}`).join('\n\n')}\n`
      : allSkills.length > 0 
        ? `\n📚 SKILLS: ${allSkills.length} skills available but none matched. Use <search_skills> to find relevant skills.\n`
        : `\n📚 SKILLS: No skills installed. Add .md files to /skills folder or run: npx skills add NeverSight/skills_feed --skill <name>\n`;

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

    // Keep history to 4 turns (last 4 actions) — enough context for multi-step auto mode
    const safeHistory = Array.isArray(history) ? history.slice(-4) : [];
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

    // ── LOAD SSH MEMORY ──
    const dbConnection = await connectDB(customerDbUri);
    const repo = new SshMemoryRepository(dbConnection);
    await repo.init();

    let memBlock = '';
    let memoryDoc = null;
    try {
      if (host) {
        memoryDoc = await repo.findOne({ userId: session.user.email, host });
        if (memoryDoc) {
          memBlock = `[SERVER BRAIN - PERSISTENT FACTS]
OS: ${memoryDoc.os || 'unknown'}
User: ${memoryDoc.loginUser || 'unknown'}
PM: ${memoryDoc.packageManager || 'unknown'}
Paths: ${memoryDoc.keyPaths?.join(', ') || 'none'}
Tools: ${memoryDoc.installedTools?.join(', ') || 'none'}
Services: ${memoryDoc.runningServices?.join(', ') || 'none'}
${memoryDoc.reminders?.length ? `REMINDERS (Diagnostic/Maintenance Tips):\n${memoryDoc.reminders.map(r => `- [${r.category}] ${r.title}: \`${r.command}\``).join('\n')}\n` : ''}
${memoryDoc.notes?.length ? `NOTES:\n${memoryDoc.notes.map(n => `- ${n.content}`).join('\n')}\n` : ''}
`;
        }
      }
    } catch (e) {
      console.warn('[SSH Memory] Load failed:', e.message);
    }

    // ── AGENTIC CORE LOGIC (shared between modes) ────────────────────────────
    // Build a dynamic skills discovery block for the prompt
    const availableSkillNames = allSkills.map(s => s.name).join(', ') || 'none';
    const agentCoreBlock = `
════════════════════════════════════════════════════════
 🤖 AGENTIC AI DevOps Engineer — Modular Skill System
════════════════════════════════════════════════════════
You are a Self-Healing AI DevOps Agent. You operate in a persistent "Think → Act → Observe" loop.
You have access to specialised SKILLS (loaded below). You NEVER give up on a goal until it is VERIFIED as fixed.

AVAILABLE SKILLS TOOLBOX: (${availableSkillNames})
→ Before acting, check if a skill covers the request. Skills contain expert runbooks, detection patterns, and commands.
→ Prefer skill knowledge over improvising. Good engineers follow runbooks.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 THINK → ACT → OBSERVE PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every response MUST follow this cycle:

PHASE 1 — THINK (in <thought>):
  • What is the user asking for? (bug fix / server help / deployment / config)
  • What is the CURRENT STATE? (read terminal output carefully)
  • What SKILL, if any, applies? (nginx, pm2-deployment, docker, troubleshooting…)
  • What is the TARGET STATE? (exactly what needs to be true for done=true)
  • What is my plan? (ordered steps with dependencies)
  • What COULD go wrong and how will I detect it?

PHASE 2 — ACT (in <command> or <diff>):
  • Execute ONE precise action that moves toward the target state.
  • Prefer diagnostic → fix → verify. Never jump straight to destructive commands.
  • Use the appropriate skill runbook for the task type.
  • ⚠️ ONE COMMAND PER TURN — ALWAYS. NEVER chain dependent commands into one response. Each command runs in its own turn and you see the result before the next. This is critical for long-running operations: cargo build, make, npm install, dd, etc. can take minutes — the system waits for the shell prompt to return before calling you again. DO NOT send post-build steps (cp, chmod, verify) in the same turn as the build command.

PHASE 3 — OBSERVE (next turn, reading the terminal output):
  • Did the command succeed? Did the output match expectations?
  • If ERROR: classify it (type 1-7 below) and pick recovery strategy.
  • If SUCCESS: verify the fix before declaring done.
  • NEVER declare done=true unless you have EVIDENCE the goal is met.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SELF-HEALING ERROR RECOVERY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a command fails, classify the error and escalate through these levels:

Error Type → Recovery Action:
1. "Permission denied"        → Add sudo. Check: ls -la PATH. Fix ownership.
2. "No such file/directory"   → Find file: find / -name FILENAME -not -path '*/proc/*' 2>/dev/null | head -5
                                 Never repeat same wrong path twice.
3. "Port already in use"      → find PID: lsof -i :PORT → decide kill or reconfigure.
4. "Command not found"        → Detect available tools. Install if needed. Never assume a tool exists.
5. "Syntax error"             → Fix the syntax. Never just retry same command. Validate: nginx -t, bash -n FILE.
6. "Service failed to start" / "Job for X.service failed" →
   STEP A (MANDATORY FIRST): journalctl -xeu SERVICE.service -n 50 --no-pager
   STEP B: Read the actual error in the journal (e.g. port conflict, config error, missing file, permission)
   STEP C: Fix the ROOT CAUSE shown in the journal
   STEP D: ONLY THEN retry: systemctl restart SERVICE
   ⚠️ NEVER retry systemctl restart without first running journalctl. Blind retries = infinite loop.
7. "Connection refused"       → Check service running: systemctl status SERVICE --no-pager. Check port binding: ss -tlnp.

ESCALATION LADDER:
  Level 1: Fix obvious issue (typo, wrong path, missing sudo)
  Level 2: Try alternative command (dnf → yum, ss → netstat, etc.)
  Level 3: Gather diagnostics to understand root cause
  Level 4: Try completely different approach
  Level 5: If truly stuck after 3 attempts with different approaches → stop, explain in <explain>, set done=false.

PERSISTENCE RULE: Do NOT stop just because one command failed. Diagnose, adapt, retry with a DIFFERENT method.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 REQUEST CLASSIFICATION & ROUTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Classify the request and apply the correct workflow:

┌───────────────────┬─────────────────────────────────────────────────────┐
│ Type              │ Action Path                                         │
├───────────────────┼─────────────────────────────────────────────────────┤
│ Bug Fix / Error   │ Read logs → Identify root cause → Fix → Verify      │
│ Help Desk Request │ Check service status first (read-only) → Diagnose   │
│ Server Config     │ Backup config → Edit → Validate syntax → Reload     │
│ Deployment        │ Scout structure → Install deps → Build → Start → Test│
│ Removal/Cleanup   │ Verify present → Remove → Verify gone → done=true   │
│ Performance       │ Gather metrics → Identify bottleneck → Tune → Verify │
│ New Tooling/Task  │ Search SkillsMP (see below) → Install → Follow      │
└───────────────────┴─────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🔍 REMOTE SKILL DISCOVERY (SkillsMP.com)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have a "Live Search" capability via SkillsMP.com. 
RULE: If you are asked to deploy or configure a technology (e.g., Docker, Kubernetes, Nginx, Redis) and you do NOT have a comprehensive local skill (.md) that covers that specific setup:
1. DO NOT guess the commands. 
2. USE <search_skills>keyword</search_skills> immediately.
3. Once you see the search results in the NEXT step, select the most relevant one and suggest installation.

SCENARIO: If asked "run on docker", and you don't see a local 'docker' skill with deployment patterns -> Use <search_skills>docker deployment</search_skills>.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GOAL VERIFICATION PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEVER set done=true based on assumptions. You MUST verify:
  • Service fix: systemctl is-active SERVICE → must show "active"
  • Config fix: run the config test command (nginx -t, etc.)
  • Deployment: curl http://localhost:PORT → must return HTTP 200
  • File edit: cat file | grep CHANGED_CONTENT → must show the change
  • Port fix: ss -tlnp | grep :PORT → must show listening

If you applied a fix but haven't yet verified → set done=false, run verification next step.
If verification passes → THEN set done=true. NEVER output <command> and <done>true</done> in the same response. Wait for the verification output first!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SAFETY LAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ALWAYS backup config files before editing: cp FILE FILE.bak.\$(date +%s)
• NEVER restart services without testing config first (nginx -t, etc.)
• For help-desk requests: start with READ-ONLY commands (status, logs, ps)
• Set danger=true for: rm -rf, disk format, user deletion, network resets
• NOTE: If preferSudo is true, standard sudo commands (apt, systemctl, cp) are NOT dangerous. Set danger=false.
• If goal is "remove X": NEVER install X. If output shows removed → done=true immediately.
`;

    // ── CODE / FILE EDITOR MODE ──────────────────────────────────────────────
    const codeEditorSys = `${agentCoreBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 MODE: CODE / FILE EDITOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENV: user=${packUser} host=${packHostname} cwd=${packCwd}

${memBlock}
OUTPUT XML FORMAT (STRICT):
<thought>
Problem Analysis: What exactly is the issue?
Current State: What does the system look like now?
Target State: What should it look like when fixed?
Skill Used: [skill name or none]
Approach: How will you solve this? (direct edit, config change, service restart, etc)
Risk Assessment: What could go wrong? How will you prevent it?
</thought>
<plan>
Step-by-step checklist with clear dependencies:
1. [ ] Read current file state (MANDATORY first step for any file edit)
2. [ ] Backup existing file
3. [ ] Make the necessary changes via <diff>
4. [ ] Verify the changes are correct
5. [ ] Restart/reload services if needed
Mark steps as DONE when complete. Only check off after verification.
</plan>
<diff>
--- ${packCwd}/example_file.ext
+++ ${packCwd}/example_file.ext
@@ -1,3 +1,3 @@
 context line 1
-removed line
+added line
 context line 3
</diff>
<command>cat /absolute/path/to/file</command>
<reminder>{"title": "Check logs", "command": "tail -f /var/log/app.log", "category": "nginx"}</reminder>
<fact>{"workingDir": "/var/www/html", "installedTools": ["nginx", "certbot"]}</fact>
<explain>I've updated the logic to handle ... ✨</explain>
<danger>false</danger><done>false</done>

🚀 PATCHING RULES (STRICT):
1. MANDATORY CONTEXT: Every @@ hunk MUST include 3 lines of unchanged context.
2. VERIFY FIRST (TWO-TURN RULE): Run <command>cat -n FILE</command> first. NEVER guess file contents.
   - Turn 1: Output ONLY <command>cat file</command>. Set <done>false</done>.
   - Turn 2: Read output, then output your <diff>. Set <done>true</done>.
3. ABSOLUTE PATHS: Use full path in diff headers. Your CWD is: ${packCwd}
4. NO PLACEHOLDERS: Use EXACT file content. Never use "existing context" as filler.
5. NEVER output a <diff> and a <command> in the same response.
6. After applying a diff, verify it: cat file | grep -A2 -B2 'changed_section'
7. NEVER use interactive editors: vi, vim, nano. NEVER use stdin-blocking writes like <command>cat > file</command> or <command>tee file</command>.
8. For NEW files, use ONE quoted heredoc command only: <command>cat << 'EOF' > file\n...\nEOF</command>. Do NOT start bare cat and then type content interactively.

WHEN TO SET done=true (PATCH MODE):
- ✅ You output a <diff> AND it is the final edit needed → done=true IMMEDIATELY
- ✅ Terminal shows "patching file..." or "Hunk #N succeeded" → done=true
- ❌ NEVER loop: cat → diff → cat → same diff → this is broken, set done=true now

FILE DISCOVERY:
1. Check cwd first: ls ${packCwd}/FILENAME 2>/dev/null
2. Check SERVER BRAIN Paths for known file locations
3. Wider search: find /home -name "FILENAME" 2>/dev/null | head -5
4. Last resort: find / -name "FILENAME" -not -path "*/proc/*" 2>/dev/null | head -10

${enforcePatch ? `PATCH-FIRST (VSCode mode): ALL modifications to EXISTING files MUST use <diff>.
  Forbidden in <command>: sed -i, tee, printf >.
  Allowed in <command>: read/verify only (cat/head/tail/grep/test).
  EXCEPTION 1: <command>truncate -s 0 FILE</command> to clear a file.
  EXCEPTION 2: To create completely NEW files, DO NOT use <diff>. Instead use <command>cat << 'EOF' > filename\ncontent\nEOF</command>.` : `LEGACY EDITING: You may use surgical commands (sed -i) when needed.`}
${structuredContext}`;

    // ── SSH COMMAND MODE (default) ────────────────────────────────────────────
    const sshCommandSys = `${agentCoreBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 MODE: SSH COMMAND AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENV: user=${packUser} host=${packHostname} cwd=${packCwd} sudo=${preferSudo}

${memBlock}
⚡ SUDO SETUP — RUN ONCE AT THE VERY START (before any other command):
Cloud instances (EC2, DigitalOcean, Contabo, etc.) often have NOPASSWD sudo already configured. Confirm it is set up and never broken by running:
<command>sudo grep -qr NOPASSWD /etc/sudoers /etc/sudoers.d/ 2>/dev/null && echo "NOPASSWD_OK" || (USER=$(whoami); echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/99-nopasswd > /dev/null && echo "NOPASSWD_SET")</command>
If this outputs NOPASSWD_OK or NOPASSWD_SET, all future sudo commands will run without a password prompt. If it fails with "permission denied", the server requires a real password — tell the user.
NEVER use sudo -S to pipe passwords. NEVER echo passwords into sudo. Just ensure NOPASSWD is in sudoers first.

⚠️ MEMORY SAFEGUARD — MANDATORY BEFORE ANY HEAVY OPERATION:
This applies to: npm install, yarn install, pip install, cargo build, cargo install, make, cmake, docker build, gcc/g++, or any compilation/build step.
BEFORE starting ANY of the above, run this ONE command unconditionally — it is fully idempotent (safe even if swap already exists):
<command>sudo bash -c 'MEM=$(free -m | awk "/^Mem:/{print $2}"); if [ "$MEM" -lt 4000 ]; then echo "RAM=$MEM MB < 4GB — ensuring 4G swap"; [ -f /swapfile ] || { fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress; chmod 600 /swapfile; mkswap /swapfile; }; swapon /swapfile 2>/dev/null; grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab; echo "Swap ready"; fi; free -m'</command>
DO NOT skip. DO NOT try to evaluate RAM or swap state yourself — the command handles it internally. cargo build --release can use 2–4 GB RAM and WILL be OOM-killed on small instances without swap.

🚀 DEPLOYMENT WORKFLOW (when deploying/starting apps):
STEP 1: Scout → ls -la && cat package.json | head -20 (or Dockerfile)
STEP 2: Analyze → What type? Deps installed? Entry point? Port free?
STEP 3: Check RAM → (already handled by MEMORY SAFEGUARD above)
STEP 4: Prepare → build image / install deps?
STEP 5: Deploy → pm2 start / docker run / docker-compose up -d
STEP 6: Verify → check logs or curl localhost. Wait for output.
STEP 7: Finish → ONLY AFTER verification passes, output <done>true</done>. Never set done=true in the same turn as a command.

🔧 SYSTEM DETECTION (ALWAYS detect before assuming):
- Firewall: command -v firewall-cmd || command -v ufw || command -v iptables || echo none
- Package mgr: cat /etc/os-release | grep -E '^ID=' && command -v apt-get dnf yum apk 2>/dev/null
- Init system: ps -p 1 -o comm= && command -v systemctl 2>/dev/null

OUTPUT XML FORMAT (STRICT):
<thought>
Situation Assessment: Current state based on terminal output?
Skill Routing: Which skill applies? (${availableSkillNames})
Hypothesis: What is wrong and why?
Plan: Ordered steps to reach target state?
Verification: How will I confirm success?
</thought>
<plan>
1. [ ] Diagnose / gather intelligence
2. [ ] Apply fix
3. [ ] Verify resolution
4. [ ] Final check / cleanup
</plan>
<command>Single shell command. Options:
- Diagnostics: ps, ss, systemctl status --no-pager, journalctl --no-pager, df, free, curl
- Package: apt/dnf/apk install, npm/pip install
- Process: pkill, kill, systemctl start/stop/restart
- Control: [Wait], [Ctrl+C], y (for interactive prompts only)</command>
<explain>One sentence with emoji. Be specific about what you're checking or fixing. ✨</explain>
<reminder>{"title": "Short title", "command": "diagnostic-cmd", "category": "skill-name"}</reminder>
<fact>{"os": "Ubuntu 22.04", "loginUser": "ubuntu", "packageManager": "apt"}</fact>
<danger>false</danger><done>false</done>
<interactive>sudo_password</interactive>

TAG PICK-ONE RULE: NEVER list all options with `|`. Pick exactly ONE:
  interactive: [sudo_password, password, passphrase, confirm_yn, generic]
  danger: [true, false]
  done: [true, false]

NGINX GOTCHAS (CHECK IF ERROR OCCURS):
- Error "unexpected end of file" in /etc/nginx/sites-enabled/FILENAME?
  - CAT THE FILE: If it's just one word (e.g. "remider"), it's corrupted.
  - FIX: Replace with a VALID server block (server { ... }) reverse-proxying to your port.
  - Verify with nginx -t BEFORE restart.


COMMAND INTELLIGENCE:
- Chain safely: cmd1 && cmd2 (only run cmd2 if cmd1 succeeds)
- Conditional: test -f file && echo exists || echo missing
- ⚠️ ALWAYS use --no-pager for journalctl and systemctl — NEVER omit it. Example: journalctl -xeu nginx.service -n 50 --no-pager. Without --no-pager the output opens in less which blocks the engine.
- Use head -N to cap long outputs
- NEVER use interactive editors or pagers for editing/inspection: vi, vim, nano, less, more, man.
- NEVER use stdin-blocking commands such as bare <command>cat</command>, <command>cat > file</command>, or <command>tee file</command>. Use <command>cat FILE</command>, <command>head</command>, <command>tail</command>, or a single quoted heredoc instead.
- sudo: ${preferSudo ? 'PREFERRED — use sudo for system-level ops. Set danger=false.' : 'AVOID unless necessary'}

WAIT PROTOCOL (MANDATORY — VIOLATIONS CAUSE BROKEN INSTALLS):
1. Terminal shows "STILL RUNNING" or no shell prompt → YOU MUST output <command>[Wait]</command>. NO EXCEPTIONS.
2. Output still flowing (progress bars, Downloading, Extracting, Installing) → <command>[Wait]</command>
3. Shell prompt ($ or #) visible → ready for next command
4. "(END)" or ":" pager → q to exit
5. "(y/n)" → y or n
6. NEVER send a shell command while another is running — this corrupts the terminal state.
7. Package installs (yum/apt/dnf/pip/npm/gem/cargo/brew) can be SILENT for 1-3 minutes during download/extraction. Keep sending [Wait] until the prompt returns.
8. If you see partial install output with no prompt → [Wait]. NEVER assume it finished.
9. If you accidentally open vi/vim → exit with [ESC] then :q! ; if nano → ^X then N ; if a command is waiting for stdin (bare cat / cat > file / tee file) → [Ctrl+C].

INTERACTIVE PROMPT HANDLING:
- "(y/n)" or "[Y/n]" → y
- "Password:" / "user@host's password:" / "Password for user postgres:" → treat as password input required; pause instead of guessing
- For sudo in automation, prefer non-interactive failure over hanging: use sudo -n so missing credentials fail fast
- "Are you sure?" → danger=true

PROCESS & NETWORK DIAGNOSTICS:
- Processes: ps auxf, pgrep -a NAME
- Ports: ss -tlnp || netstat -tlnp
- Connections: lsof -i -P -n | grep LISTEN
- DNS: dig DOMAIN || nslookup DOMAIN
- Traffic: curl -sI URL (use -I to get headers only)

SELF-CORRECTION HIERARCHY:
Level 1: Fix obvious (wrong path, typo, sudo missing)
Level 2: Alternative command (dnf↔yum, ss↔netstat)
Level 3: More diagnostics (journalctl, tail logs)
Level 4: Completely different approach
Level 5: Stop with explanation if 3+ attempts all failed differently

EMOJIS FOR STATUS:
🔍=Investigating 📊=Status check 📦=Installing 🔧=Fixing ✅=Verified 🚀=Deployed 🔄=Retrying ⚠️=Warning ❌=Failed 💡=Tip
${structuredContext}`;

    const backgroundTmuxSys = autoTmux ? `
TMUX ENVIRONMENT (ACTIVE):
- This terminal is running inside tmux session 'main'. A dedicated background session 'ai-bg-task' also exists.
- YOU MUST use tmux for ANY command that may block for more than a few seconds (installs, builds, downloads, service restarts, etc.).
- Use ONE canonical log file and completion sentinel:
- Start long job: <command>tmux has-session -t ai-bg-task 2>/dev/null || tmux new-session -d -s ai-bg-task; tmux send-keys -t ai-bg-task:0.0 "sh -lc 'your_long_command > /tmp/ai-bg-task.log 2>&1; code=$?; echo __AI_DONE__:$code >> /tmp/ai-bg-task.log'" C-m</command>
- Check progress: <command>tail -n 30 /tmp/ai-bg-task.log</command>
- Check completion: <command>grep '__AI_DONE__:' /tmp/ai-bg-task.log | tail -1 || tail -n 30 /tmp/ai-bg-task.log</command>
- If the sentinel is absent, the job is still running → use <command>[Wait]</command> and check again later.
- If tmux ever says "can't find pane" or "can't find session", recreate it first with: <command>tmux has-session -t ai-bg-task 2>/dev/null || tmux new-session -d -s ai-bg-task</command>
- Short/instant commands (ls, cat FILE, systemctl status --no-pager, grep, echo) can run directly without tmux.
- NEVER use 'tmux attach' or 'tmux attach-session' — you are already inside tmux.
- NEVER use 'tmux wait-for -L' here — it can block forever without a matching unlock.
- NEVER run blocking commands (yum install, npm install, cargo build, make, etc.) directly — always use tmux send-keys to ai-bg-task.` : '';

    const sys = (aiTask === 'code' ? codeEditorSys : sshCommandSys) + '\n' + backgroundTmuxSys + skillBlock;


    // Proactively inject file paths from memory into the user prompt if they match the filename
    let enhancedPrompt = String(prompt);
    if (memoryDoc?.keyPaths?.length) {
      const mentionedFile = enhancedPrompt.match(/(\w+\.\w+)/)?.[0];
      if (mentionedFile) {
        const foundPath = (memoryDoc.keyPaths || []).find(p => p.endsWith(mentionedFile));
        if (foundPath) {
          // Check if we've already tried this path and failed (preventing loops)
          const lastResp = historyMessages[historyMessages.length - 1]?.content || '';
          const pathIsStale = lastResp.includes(foundPath) && (lastResp.includes('No such file') || lastResp.includes('does not exist'));
          
          if (!pathIsStale) {
            // Suggest the path but don't force it as the only truth
            enhancedPrompt = `(MEMORY: Possible absolute path for ${mentionedFile} is ${foundPath})\n\n${enhancedPrompt}`;
          } else {
             // Warms the AI that the memory is wrong
            enhancedPrompt = `(MEMORY WARNING: The saved path ${foundPath} for ${mentionedFile} appears to be STALE/WRONG. Perform discovery with 'find' or 'ls' instead.)\n\n${enhancedPrompt}`;
          }
        }
      }
    }

    const messages = [
      { role: 'system', content: sys },
      ...historyMessages,
      { role: 'user', content: enhancedPrompt },
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
  Use safe paths like: home/ubuntu/workspace/some_file.ext (the UI applies patch with -d /).
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
    if (streamRequested) {
      const isManual = mainModel === 'manual';
      const chosenApiKey = isManual ? prefs?.aiApiKey : (apiKeys[currentIndex] || apiKeys[0]);
      
      if (!chosenApiKey) {
        return NextResponse.json({ success: false, error: isManual ? 'Missing Manual API Key in settings.' : 'Missing AI API key.' }, { status: 400 });
      }

      const apiUrl = isManual ? (prefs?.aiEndpoint || 'https://api.openai.com/v1/chat/completions') : 'https://api.groq.com/openai/v1/chat/completions';
      const actualModelToRequest = isManual ? (prefs?.aiCustomModel || 'gpt-3.5-turbo') : mainModel;

      try {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let full = '';
            let usedModel = actualModelToRequest;
            try {
              controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ model: usedModel })}\n\n`));

              const fetchHeaders = {
                Authorization: `Bearer ${chosenApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://zeroclaw.local',
                'X-Title': 'ZeroClaw Monitor'
              };

              const response = await fetch(apiUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify({
                  messages,
                  model: actualModelToRequest,
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
                const streamHistoryRepo = new AiHistoryRepository(centralDb);
                await streamHistoryRepo.init();
                const missionTitle = contextPack?.goal || prompt.slice(0, 50);
                const oneHourAgo = new Date(Date.now() - 3600000);
                let historyRecord = await streamHistoryRepo.findOne({
                  userId: session.user.email,
                  type: 'terminal',
                  title: missionTitle,
                  updatedAt: { $gt: oneHourAgo }
                });

                const newMessagePair = [
                    { role: 'user', content: prompt || '(no prompt)', timestamp: new Date() },
                    { role: 'assistant', content: full || '(no response)', metadata: { usedModel }, timestamp: new Date() }
                  ];
                if (historyRecord) {
                  await streamHistoryRepo.updateOne(
                    { _id: historyRecord._id },
                    { $push: { messages: { $each: newMessagePair } }, $set: { lastActive: new Date() } }
                  );
                } else {
                  await streamHistoryRepo.create({
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
                // SSH Memory extraction
                const hasFact = /<fact>[\s\S]*?<\/fact>/i.test(full);
                const hasReminder = /<reminder>[\s\S]*?<\/reminder>/i.test(full);
                const hasCompletion = /<done>\s*true\s*<\/done>/i.test(full);

                if (hasFact || hasCompletion || hasReminder) {
                  const cooldownKey = `stream:${session.user.email}:${host}:${contextPack?.goal || 'unk'}`;
                  const lastExtracted = extractCooldownMap.get(cooldownKey) || 0;
                  const isLongEnoughSinceLast = Date.now() - lastExtracted > 4000;

                  if (isLongEnoughSinceLast) {
                    extractCooldownMap.set(cooldownKey, Date.now());
                    handleSshMemoryExtraction(session.user.email, host, full, contextPack?.goal);
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
                        'HTTP-Referer': 'https://zeroclaw.local',
                        'X-Title': 'ZeroClaw Monitor'
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
                    const prefix = String(apiKey || '').slice(0, 10);
                    throw new Error(`AI service error (${response.status}) [Key: ${prefix}...]: ${errBody.slice(0, 200)}`);
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
             settingsRepo.update({ key: 'ai_api_keys' }, { 'value.currentIndex': nextIndex })
               .catch(e => console.error('Failed to update API key rotation index', e));
        }
        
        let usageInfo = null;
        if (session) {
          usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, answer);
          
          // PERSIST HISTORY
          try {
            const historyRepo = new AiHistoryRepository(centralDb);
            await historyRepo.init();
            const missionTitle = contextPack?.goal || prompt.slice(0, 50);
            
            const oneHourAgo = new Date(Date.now() - 3600000);
            let historyRecord = await historyRepo.findOne({
              userId: session.user.email,
              type: 'terminal',
              title: missionTitle,
              updatedAt: { $gt: oneHourAgo }
            });

            const newMessagePair = [
                { role: 'user', content: prompt || '(no prompt)', timestamp: new Date() },
                { role: 'assistant', content: answer || '(no response)', metadata: { usedModel: actualUsedModel }, timestamp: new Date() }
            ];
            if (historyRecord) {
              await historyRepo.updateOne(
                { _id: historyRecord._id },
                { $push: { messages: { $each: newMessagePair } }, $set: { lastActive: new Date() } }
              );
            } else {
              await historyRepo.create({
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

          // SSH Memory extraction
          handleSshMemoryExtraction(session.user.email, host, answer, contextPack?.goal);
          answer = normalizeAiXml(answer);
        } // end if (session)

        return NextResponse.json({ success: true, answer, usage: usageInfo, usedModel: actualUsedModel });
    }
    
    // If we are here, we failed
    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });
  } catch (error) {
    console.error('SSH AI Help Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
