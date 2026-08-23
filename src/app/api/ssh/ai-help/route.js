import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import { AiHistoryRepository } from '@/lib/repositories/AiHistoryRepository';
import { SshMemoryRepository } from '@/lib/repositories/SshMemoryRepository';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';
import { canUseServerAi, aiSupporterRequiredResponse } from '@/utils/supporter';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/lib/logger';

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

// Helper to extract arrays from Markdown YAML frontmatter
function extractKeywords(content, field) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const lineMatch = fmMatch[1].match(new RegExp(`^${field}:\\s*(.*)$`, 'im'));
  if (!lineMatch) return [];
  let val = lineMatch[1].trim();
  if (val.startsWith('[') && val.endsWith(']')) {
    val = val.slice(1, -1);
  }
  return val.split(',').map(s => s.trim().toLowerCase().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// Helper to extract a single string value from YAML frontmatter
function extractFrontmatter(content, field) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const lineMatch = fmMatch[1].match(new RegExp(`^${field}:\\s*(.*)$`, 'im'));
  if (!lineMatch) return null;
  return lineMatch[1].trim().replace(/^['"]|['"]$/g, '');
}

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
        const defaultName = file.replace('.md', '');
        const name = extractFrontmatter(content, 'name') || defaultName;
        const description = extractFrontmatter(content, 'description') || '';
        let keywords = extractKeywords(content, 'keywords');
        let primaryKeywords = extractKeywords(content, 'primary_keywords');
        if (keywords.length === 0) keywords = [name.toLowerCase().replace(/-/g, ' ')];
        skills.push({ name, description, content: truncateSkill(content, MAX_SKILL_CHARS), source: 'custom', keywords, primaryKeywords });
      } catch (e) {
        logger.warn(`Failed to load skill ${file}:`, e.message);
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
            const name = extractFrontmatter(content, 'name') || entry.name;
            const description = extractFrontmatter(content, 'description') || '';
            let keywords = extractKeywords(content, 'keywords');
            let primaryKeywords = extractKeywords(content, 'primary_keywords');
            if (keywords.length === 0) keywords = [name.toLowerCase().replace(/-/g, ' ')];
            skills.push({ name, description, content: truncateSkill(content, MAX_SKILL_CHARS), source: 'skillsmp', keywords, primaryKeywords });
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
    const keywords = skill.keywords || [];
    const primary = skill.primaryKeywords || [];

    const skillNameVariants = [
      skillName,
      skillName.replace(/-/g, ' '),
      skillName.replace(/-/g, ''),
    ].filter(Boolean);

    const skillDesc = String(skill.description || '').toLowerCase();
    const nameHitPrompt = skillNameVariants.some(v => v && promptText.includes(v));
    const nameHitContext = skillNameVariants.some(v => v && contextText.includes(v));
    const descHitPrompt = skillDesc && promptText.includes(skillDesc.slice(0, 30)); // Match start of desc
    const kwHitsPrompt = scoreKeywordHits(promptText, keywords);
    const kwHitsContext = scoreKeywordHits(contextText, keywords);

    const hasPrimaryInPrompt = primary.length ? primary.some(kw => promptText.includes(kw)) : true;
    
    // 🧪 ROBUSTNESS: If the prompt contains a significant chunk of the description, it's a strong signal
    const strongSignal = nameHitPrompt || descHitPrompt;

    // ── STRICT MATCHING: The user must intend to use the skill ──
    // Do not match if there is absolutely no signal in the prompt itself.
    if (!nameHitPrompt && !descHitPrompt && kwHitsPrompt === 0) {
      continue;
    }

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
    if (nameHitPrompt) score += 15;
    if (nameHitContext) score += 2;
    if (descHitPrompt) score += 10;
    score += kwHitsPrompt * 4;
    score += kwHitsContext * 1;

    // Threshold boost for very strong signals
    if (strongSignal && score > 0) score += 5;

    // If primary keywords are defined, require prompt primary match.
    if (!hasPrimaryInPrompt) score = 0;
    // If negative product name match, suppress
    if (negativePenalty) score = 0;

    // Threshold to avoid accidental matches (e.g. URLs causing ssl-related hits)
    if (score >= 15) scored.push({ skill, score });
  }

  scored.sort((a, b) => b.score - a.score);
  // Cap to 2 to reduce token usage and accidental over-matching.
  return scored.slice(0, 2).map(x => x.skill);
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
        logger.warn('[SSH Memory] Failed to parse <fact> JSON:', e.message);
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
        logger.warn('[SSH Memory] Failed to parse <reminder> JSON:', e.message);
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
    logger.error('[SSH Memory] Extraction failed:', err);
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

    // AI is a supporter feature - server-funded AI requires membership.
    // Users bringing their own API key (manual mode) are always allowed.
    const usingOwnKey = model === 'manual' && !!prefs?.aiApiKey;
    if (!(await canUseServerAi(session.user.email, usingOwnKey))) {
      return aiSupporterRequiredResponse();
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
      logger.error('Error fetching AI settings from DB:', e);
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

    const safeContext = typeof context === 'string' ? context.slice(-20000) : '';
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
      availableSkills: allSkills.map(s => ({ name: s.name, description: s.description, source: s.source })),
      matchedSkills: matchedSkills.map(s => ({ name: s.name, description: s.description })),
      sources: {
        custom: allSkills.filter(s => s.source === 'custom').map(s => s.name),
        skillsmp: allSkills.filter(s => s.source === 'skillsmp').map(s => s.name)
      }
    };
    
    // Log skill status for debugging
    logger.info('[Skills] Available:', skillStatusInfo.availableSkills.map(s => `${s.name}(${s.source})`).join(', ') || 'none');
    logger.info('[Skills] Matched:', skillStatusInfo.matchedSkills.map(s => s.name).join(', ') || 'none');
    
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

    // Keep history to 5 turns — enough context for short tasks while saving tokens
    const safeHistory = Array.isArray(history) ? history.slice(-5) : [];
    const historyMessages = safeHistory.flatMap(h => {
      const msgs = [];
      if (h.role === 'user' && h.content) {
        const text = String(h.content);
        const autoMatch = text.match(/- Last command:\s*(.*?)\n- Output:\n([\s\S]*?)(?=\n⚡|\n\[!]|\nStep|$)/i);
        if (autoMatch) {
          msgs.push({ role: 'user', content: `Previous Result:\nCMD: ${autoMatch[1]}\nOUTPUT:\n${autoMatch[2].trim().slice(-300)}` });
        } else {
          msgs.push({ role: 'user', content: text.slice(0, 200) });
        }
      }
      if (h.role === 'assistant' && h.content) {
        // For assistant messages, only keep the command/diff tag to save tokens
        const cmdMatch = String(h.content).match(/<command>([\s\S]*?)<\/command>/i);
        const diffMatch = String(h.content).match(/<diff>([\s\S]*?)<\/diff>/i);
        const doneMatch = String(h.content).match(/<done>(true|false)<\/done>/i);
        const brief = cmdMatch
          ? `CMD:${cmdMatch[1].trim().slice(0, 300)}${doneMatch?.[1]==='true'?' DONE':''}`
          : diffMatch
            ? `DIFF:\n${diffMatch[1].trim().slice(0, 1500)}${diffMatch[1].length > 1500 ? '\n... (truncated)' : ''}${doneMatch?.[1]==='true'?'\nDONE':''}`
            : String(h.content).slice(0, 500);
        msgs.push({ role: 'assistant', content: brief });
      }
      return msgs;
    });

    const packConnName = safePack?.connectionName || connectionName || '?';
    const packHost = safePack?.host || host || '?';
    const packLastCmd = typeof safePack?.lastCommand === 'string' ? safePack.lastCommand.slice(0, 150) : '';
    const packRecentCmds = Array.isArray(safePack?.recentCommands) ? safePack.recentCommands.slice(-3) : [];
    const packLastError = safePack?.lastError && typeof safePack.lastError === 'object' ? safePack.lastError : null;
    // Use 1k chars of terminal tail — keep context strict to save tokens
    const packTail = typeof safePack?.terminalTail === 'string' ? safePack.terminalTail.slice(-1000) : typeof safeContext === 'string' ? safeContext.slice(-1000) : '';

    const structuredContext = safePack
      ? `CTX:
Cmds:${packRecentCmds.length ? packRecentCmds.map(c => String(c).slice(0, 80)).join('|') : 'none'}
Last:${packLastCmd || 'none'}
Err:${packLastError ? `${packLastError.label}: ${String(packLastError.excerpt||'').slice(-200)}` : 'none'}
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
Paths: ${memoryDoc.keyPaths?.slice(0, 10).join(', ') || 'none'}
Tools: ${memoryDoc.installedTools?.slice(0, 10).join(', ') || 'none'}
Services: ${memoryDoc.runningServices?.slice(0, 10).join(', ') || 'none'}
${memoryDoc.reminders?.length ? `REMINDERS:\n${memoryDoc.reminders.slice(0, 3).map(r => `- [${r.category}] ${r.title}: \`${r.command}\``).join('\n')}\n` : ''}
${memoryDoc.notes?.length ? `NOTES:\n${memoryDoc.notes.slice(0, 3).map(n => `- ${n.content}`).join('\n')}\n` : ''}
`;
        }
      }
    } catch (e) {
      logger.warn('[SSH Memory] Load failed:', e.message);
    }

    // ── AGENTIC CORE LOGIC (shared between modes) ────────────────────────────
    // Build a dynamic skills discovery block for the prompt
    let availableSkillNames = allSkills.map(s => s.name).slice(0, 5).join(', ') || 'none';
    if (allSkills.length > 5) availableSkillNames += ', ...';
    const agentCoreBlock = `You are a Self-Healing AI DevOps Agent. Think→Act→Observe loop. NEVER give up until goal is VERIFIED.
SKILLS: (${availableSkillNames}) — If a loaded skill matches, follow it EXACTLY. No improvising.

EVERY RESPONSE:
<thought>Analyze the terminal output provided. Is there an error? If so, what is the fix?</thought>
<command>ONE shell command</command> OR <diff>unified diff</diff>
<explain>1 sentence</explain><danger>false</danger><done>false</done>

RULES:
• You are responsible for detecting errors (e.g., "GLIBC", "Permission denied", "Not found"). 
• If you see an error, output the fix in <command>. Do NOT output the error message itself as a command.
• If you see interactive prompts (e.g., "[y/n]", "Press Enter", "Password:"), output the answer in the <command> tag immediately.
  Example: If you see "[y/n]", output: <command>y</command>
• If you get stuck in a secondary prompt due to an unclosed quote or syntax error (e.g. ">" prompt), output "<command>\\x03</command>" to send Ctrl+C and exit it before trying again.
• Verify the goal is met by reading the output. Only set <done>true</done> when you see evidence (e.g., "Active: active", version string, file content).
• Do not trust "Success" messages without terminal evidence.
• ONE command per turn. NEVER chain dependent commands.
• Anti-loop: NEVER repeat same failing command >2 times.
• GLIBC error: build from source, NEVER upgrade glibc.
• Backup configs: cp FILE FILE.bak.$(date +%s)
• journalctl/systemctl: always --no-pager
• danger=true: rm -rf, disk format, user deletion.
• Docker: ALL steps INSIDE container. No sudo inside container. Use docker exec for verify.
• Service fails: journalctl -xeu SVC -n 50 --no-pager FIRST, then fix root cause, then restart.
• Search: <search_skills>keyword</search_skills> if no local skill covers the task.

REQUEST TYPES:
Bug→Read logs→Fix→Verify | Config→Backup→Edit→Validate→Reload | Deploy→Scout→Deps→Build→Start→Test→Verify | Remove→Verify present→Remove→Verify gone→done=true

VERIFY BEFORE done=true:
• Service: systemctl is-active SVC
• Deploy: curl http://localhost:PORT
• File edit: grep CHANGED FILE
• Existence alone is NOT enough — functional check required.
• All prompt constraints must be met.
• When you output <done>true</done>, DO NOT provide ANY <command> or <diff>. You MUST stop doing work immediately.
`;



    // ── CODE / FILE EDITOR MODE ──────────────────────────────────────────────
    // Code editor uses a simplified prompt WITHOUT skills or the full agentic core block
    const codeEditorSys = `You are a precise File Editor AI. You edit files via unified diff patches delivered over SFTP.
ENV: user=${packUser} host=${packHostname} cwd=${packCwd}
${memBlock}
OUTPUT FORMAT (STRICT XML):
<thought>brief analysis</thought>
<diff>unified diff patch</diff> OR <command>read-only shell command</command>
<explain>1 sentence summary</explain>
<danger>false</danger>
<done>true if edit is complete, false if more steps needed</done>

PATCHING RULES:
1. Cat file FIRST (turn 1), diff SECOND (turn 2). NEVER guess contents.
2. Every @@ hunk needs at least 6-10 unchanged context lines (use -u10 if available). Context is crucial for validation.
3. Absolute paths in diff headers. CWD=${packCwd}
4. NEVER mix <diff>+<command> in same turn.
5. NEVER use vi/vim/nano/tee/bare cat>file. New files: cat <<'EOF' > file\n...\nEOF
6. Set done=true in the SAME response as your final <diff>. Do NOT add extra verify turns.
7. After a diff is applied successfully, you are DONE. Set <done>true</done>.
8. Loop guard: if you already produced a diff and context says "PATCH APPLIED", set done=true immediately.

FILE FIND: ls ${packCwd}/FILE || find /home -name FILE 2>/dev/null | head -5
${enforcePatch ? `PATCH-FIRST: Use <diff> for ALL edits. <command> for read-only only (cat/grep/head). Exception: truncate -s 0 FILE, or cat <<'EOF'>newfile for NEW files.` : `LEGACY: sed -i allowed.`}
${structuredContext}`;

    // ── SSH COMMAND MODE (default) ────────────────────────────────────────────
    const sshCommandSys = `${agentCoreBlock}
MODE: SSH | user=${packUser} host=${packHostname} cwd=${packCwd} sudo=${preferSudo}
${memBlock}
EXTRA TAGS (optional): <reminder>{"title":"...","command":"...","category":"..."}</reminder> <fact>{"os":"...","loginUser":"...","packageManager":"..."}</fact>
NOPASSWD (if sudo needed, 1st turn): echo "$(whoami) ALL=(ALL) NOPASSWD:ALL"|sudo tee /etc/sudoers.d/99-nopasswd>/dev/null
RAM CHECK (before heavy builds): free -m && [ $(free -m|awk '/^Mem:/{print $2}') -lt 4000 ] && sudo fallocate -l 4G /swapfile&&sudo chmod 600 /swapfile&&sudo mkswap /swapfile&&sudo swapon /swapfile||true
DEPLOY: Scout→Deps→Build→Start→Verify→done=true | sudo: ${preferSudo ? 'on(danger=false for apt/systemctl)' : 'off'}
${structuredContext}`;

    const backgroundTmuxSys = autoTmux ? `
TMUX (ACTIVE): session=main, bg=ai-bg-task. Use tmux for ANY blocking cmd (installs/builds/downloads).
- Start: tmux send-keys -t ai-bg-task:0.0 "cmd>/tmp/ai-bg-task.log 2>&1;echo __AI_DONE__:$?>/tmp/ai-bg-task.log" C-m
- Poll: tail -n 20 /tmp/ai-bg-task.log | Check done: grep '__AI_DONE__:' /tmp/ai-bg-task.log
- No sentinel = still running → [Wait]. NEVER use tmux attach. NEVER use tmux wait-for -L.` : '';

    // Code mode: skip skills entirely (pure AI, keep prompt lean)
    const sys = aiTask === 'code'
      ? codeEditorSys
      : sshCommandSys + '\n' + backgroundTmuxSys + skillBlock;


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
          logger.warn('[AI retry missing diff] Retry request failed:', res.status, errBody.slice(0, 200), extraInfo);
          return null;
        }
        const out = await res.json();
        const retryAnswer = out?.choices?.[0]?.message?.content || '';
        return retryAnswer ? String(retryAnswer) : null;
      } catch (e) {
        logger.warn('[AI retry missing diff] Retry failed:', e?.message || e, extraInfo);
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
                logger.error('Failed to save AI history:', dbErr);
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
                logger.error('[SSH Memory] Streaming done handling failed:', err);
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
        logger.error('Streaming request failed, falling back:', err);
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
                    logger.warn(`AI Rate limit hit on key index ${tryIndex} for model ${currentModel}. Rotating...`);
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
        logger.warn(`All keys failed for model ${currentModel}. Trying next fallback...`);
    }

    if (successfulIndex !== -1) {
        if (apiKeys.length > 1 && successfulIndex !== 999) {
             const nextIndex = (successfulIndex + 1) % apiKeys.length;
             settingsRepo.update({ key: 'ai_api_keys' }, { 'value.currentIndex': nextIndex })
               .catch(e => logger.error('Failed to update API key rotation index', e));
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
            logger.error('Failed to save AI history:', dbErr);
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
    logger.error('SSH AI Help Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
