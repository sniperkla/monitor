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
import { getClientIp } from '@/lib/clientIp';
import { assertSafeHttpUrl } from '@/lib/ssrfGuard';

// ── Local-relay AI proxy ─────────────────────────────────────────────────────
// When the user has an active Local Relay agent announcing the 'ai' capability,
// the provider HTTP call is performed BY THE RELAY (on the user's own machine).
// The server only shuttles a small JSON envelope over the already-open relay
// WebSocket — saving server egress bandwidth and keeping the server IP out of
// provider logs. Falls back to direct server-side fetch whenever no capable
// relay exists, the relay errors, or the round-trip times out.
const AI_RELAY_TIMEOUT_MS = 180000;

async function relayAiFetch(userId, url, options) {
  const pending = global.__aiRelayPending || (global.__aiRelayPending = new Map());
  const userRelays = global.__activeRelays?.get(userId);
  if (!userRelays?.size) return null;
  let relayWs = null;
  for (const r of userRelays.values()) {
    if (r?.capabilities?.ai && r?.ws?.readyState === 1) { relayWs = r.ws; break; }
  }
  if (!relayWs) return null;

  const authHeader = options?.headers?.Authorization || options?.headers?.authorization || '';
  const apiKey = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null); // timeout → caller falls back to direct fetch
      }, AI_RELAY_TIMEOUT_MS);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        if (!msg || msg.ok === false) return resolve(null); // any relay failure → direct fallback
        // Response-like object: works for both .json()/.text() consumers and
        // SSE readers (full payload arrives as a single body chunk).
        resolve(new Response(msg.body ?? '', { status: msg.status || 200, headers: { 'Content-Type': 'application/json' } }));
      });
      relayWs.send(JSON.stringify({ type: 'ai:chat', id, endpoint: url, apiKey, body: options?.body, timeoutMs: AI_RELAY_TIMEOUT_MS - 5000 }));
    });
  } catch (_) {
    return null;
  }
}

// Drop-in replacement for fetch() targeting LLM providers.
async function llmFetch(userId, url, options) {
  if (userId) {
    try {
      const viaRelay = await relayAiFetch(userId, url, options);
      if (viaRelay) return viaRelay;
    } catch (_) { /* fall through to direct */ }
  }
  return fetch(url, options);
}

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
    // Must match the key used when the relay token was created (agent route)
    const relayUserId = session.user?.id || 'admin';

    const extractCooldownMap = globalThis.__sshMemoryExtractCooldownMap || (globalThis.__sshMemoryExtractCooldownMap = new Map());

    const { searchParams } = new URL(req.url);
    const streamRequested = searchParams.get('stream') === '1';

    const body = await req.json();
    const { prompt, context, connectionName, host, prefs, history, model, contextPack, mode, taskMode } = body;
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

    const clientIP = getClientIp(req);
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

    const executionMode = (typeof mode === 'string' && mode) 
      ? mode 
      : (typeof safePrefs.mode === 'string' ? safePrefs.mode : 'manual');
    const aiTask = (typeof taskMode === 'string' && taskMode)
      ? taskMode
      : (typeof safePrefs.aiTask === 'string' ? safePrefs.aiTask : 'ssh');

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

    // ── CRITICAL SAFETY GUARDRAILS (Harmful Command Prevention) ─────────────
    const safetyGuardrailsBlock = `
CRITICAL SAFETY RULES (PREVENT HARMFUL & DESTRUCTIVE ACTIONS):
You are operating on a live remote server over SSH.
1. ABSOLUTELY FORBIDDEN CATASTROPHIC COMMANDS:
   - NEVER output commands that wipe root or user home directories:
     FORBIDDEN: rm -rf /, rm -rf /*, rm -rf ~, rm -rf /etc, rm -rf /usr, rm -rf /var, rm -rf /boot, rm -rf /root
   - NEVER output raw disk destruction or partition wiping commands:
     FORBIDDEN: mkfs on root or mounted disks, dd wiping drives (dd if=/dev/zero of=/dev/sd*, dd of=/dev/nvme*, > /dev/sda)
   - NEVER output fork bombs (:(){ :|:& };:) or process exhaustion loops.
   - NEVER strip root permissions: chmod -R 000 /, chmod -R 777 /, chown -R on root/system dirs.
   - NEVER drop production databases or wipe all tables without explicit user request and confirmed backup.
2. SSH & NETWORK LOCKOUT PREVENTION:
   - NEVER stop, disable, or mask the SSH daemon: systemctl stop sshd, service ssh stop, systemctl disable ssh.
   - NEVER flush iptables/nftables without first allowing the active SSH port: 'iptables -F' alone will permanently lock out remote access!
   - NEVER delete or overwrite ~/.ssh/authorized_keys or /etc/ssh/sshd_config without a verified backup.
3. MANDATORY <danger>true</danger> TAGGING:
   - Mark <danger>true</danger> for ANY operation that is destructive, irreversible, or risks service disruption:
     * Deleting non-temporary files or directories (rm -r on project or configuration directories).
     * Dropping databases, truncating tables, or wiping data volumes.
     * Stopping, killing, or removing active services, containers, or processes.
     * System reboots, shutdowns (reboot, shutdown, init 0, poweroff).
     * Modifying firewall, sudoers (/etc/sudoers), or disk mounts (/etc/fstab).
   - If <danger>true</danger>, state the exact risk clearly in <explain>.
4. NON-DESTRUCTIVE DIAGNOSTICS FIRST:
   - Always prefer non-destructive inspection first: df -h, free -m, cat, grep, tail, journalctl --no-pager, systemctl status.
   - Always backup configuration files before editing: cp FILE FILE.bak.$(date +%s)
`;

    // Dynamic skills discovery block
    let availableSkillNames = allSkills.map(s => s.name).slice(0, 5).join(', ') || 'none';
    if (allSkills.length > 5) availableSkillNames += ', ...';

    // ── SSH AUTO MODE (Autonomous Think-Act-Observe DevOps Agent) ───────────
    const sshAutoSys = `You are a Self-Healing Autonomous AI DevOps Agent. Think→Act→Observe loop. NEVER give up until goal is functionally VERIFIED.
SKILLS: (${availableSkillNames}) — If a loaded skill matches, follow it EXACTLY. No improvising.
MODE: SSH AUTO-PILOT | user=${packUser} host=${packHostname} cwd=${packCwd} sudo=${preferSudo}
${memBlock}
${safetyGuardrailsBlock}

EVERY RESPONSE (STRICT XML):
<thought>Analyze current terminal output. Did the previous command succeed? If error, what is root cause and fix?</thought>
<command>ONE single executable shell command</command>
<explain>1-2 sentence concise summary of action</explain>
<danger>false or true</danger>
<done>false or true</done>

RULES FOR AUTO MODE:
• Autonomous Loop: Exactly ONE command per step. NEVER chain dependent commands.
• Error Recovery: Detect and fix errors (e.g. GLIBC, permission denied, missing deps, port conflicts). Never output raw error messages as commands.
• Interactive Prompts: If output asks [y/n] or "Press Enter", immediately output the response (e.g., <command>y</command>).
• Stuck Prompts: If stuck in an unclosed quote or prompt (e.g. ">"), output <command>\\x03</command> to send Ctrl+C.
• Functional Verification: Only set <done>true</done> when terminal evidence proves the goal is achieved (e.g. systemctl is-active, curl response, version check).
• When setting <done>true</done>, do NOT provide any command. Stop immediately.
• If a command carries risk of data loss or service disruption, set <danger>true</danger> so the engine pauses for user confirmation.
• NOPASSWD setup (if sudo needed, 1st turn): echo "$(whoami) ALL=(ALL) NOPASSWD:ALL"|sudo tee /etc/sudoers.d/99-nopasswd>/dev/null
${structuredContext}`;

    // ── SSH MANUAL MODE (Interactive Linux Administrator & Copilot) ─────────
    const sshManualSys = `You are an expert AI Linux System Administrator and SSH Copilot.
You assist the user with understanding, diagnosing, troubleshooting, monitoring, configuring, and managing their remote Linux server.
MODE: SSH MANUAL COPILOT | user=${packUser} host=${packHostname} cwd=${packCwd} sudo=${preferSudo}
${memBlock}
${safetyGuardrailsBlock}

OUTPUT FORMAT (STRICT XML):
<thought>Brief technical analysis of the user's inquiry and server state</thought>
<command>Safe shell command to run (or leave empty if purely informational)</command>
<explain>Clear, helpful, and informative explanation answering the user's question, explaining diagnostic results, or detailing what the command does</explain>
<danger>false or true</danger>
<done>true</done>

RULES FOR MANUAL COPILOT:
• Be helpful, clear, and informative. Explain why issues occur and how server components work.
• If the user asks a question (e.g. why is disk full, what is using RAM, how is nginx configured), analyze terminal output and explain thoroughly.
• If action is needed, provide ONE clean, ready-to-run command in <command>.
• Always recommend safe, read-only diagnostic commands first (e.g., df -h, free -m, journalctl -xeu SVC -n 50 --no-pager, ps aux).
• If the suggested command has any risk of disruption or data loss, set <danger>true</danger> and warn the user in <explain>.
• Set <done>true</done> for each manual answer.
${structuredContext}`;

    // ── CODE AUTO MODE (Autonomous Patch / Diff Editor) ─────────────────────
    const codeAutoSys = `You are an Autonomous File Editor AI. You edit files via unified diff patches delivered over SFTP.
MODE: CODE AUTO-PILOT | user=${packUser} host=${packHostname} cwd=${packCwd}
${memBlock}
${safetyGuardrailsBlock}

OUTPUT FORMAT (STRICT XML):
<thought>Analysis of file contents and required changes</thought>
<diff>unified diff patch</diff> OR <command>read-only shell command (cat/grep/head)</command>
<explain>1 sentence summary of change</explain>
<danger>false</danger>
<done>true if edit is complete, false if more steps needed</done>

PATCHING RULES:
1. Cat file FIRST (turn 1), diff SECOND (turn 2). NEVER guess contents.
2. Every @@ hunk needs 6-10 unchanged context lines.
3. Absolute paths in diff headers. CWD=${packCwd}
4. NEVER mix <diff> and <command> in the same turn.
5. In patch-first mode, use <diff> for all file modifications.
6. Set <done>true</done> in the same response as your final diff patch.
${structuredContext}`;

    // ── CODE MANUAL MODE (Interactive File & Code Editor Copilot) ───────────
    const codeManualSys = `You are an expert Code & File Editor Assistant for remote servers.
You help the user inspect, understand, refactor, and patch code or configuration files over SFTP.
MODE: CODE MANUAL COPILOT | user=${packUser} host=${packHostname} cwd=${packCwd}
${memBlock}
${safetyGuardrailsBlock}

OUTPUT FORMAT (STRICT XML):
<thought>Technical analysis of the file and requested changes</thought>
<diff>unified diff patch</diff> OR <command>read-only command (cat/grep/find)</command>
<explain>Clear explanation of the file structure, bug analysis, or proposed changes</explain>
<danger>false</danger>
<done>true</done>

RULES FOR CODE MANUAL COPILOT:
• Provide clean, accurate unified diff patches with 6-10 context lines.
• Explain what changes are made and why.
• For read-only inspection, provide safe commands in <command>.
• Always set <done>true</done>.
${structuredContext}`;

    const backgroundTmuxSys = autoTmux ? `
TMUX (ACTIVE): session=main, bg=ai-bg-task. Use tmux for ANY blocking cmd (installs/builds/downloads).
- Start: tmux send-keys -t ai-bg-task:0.0 "cmd>/tmp/ai-bg-task.log 2>&1;echo __AI_DONE__:$?>/tmp/ai-bg-task.log" C-m
- Poll: tail -n 20 /tmp/ai-bg-task.log | Check done: grep '__AI_DONE__:' /tmp/ai-bg-task.log
- No sentinel = still running → [Wait]. NEVER use tmux attach. NEVER use tmux wait-for -L.` : '';

    // Route system prompt based on Task Mode (code vs ssh) and Execution Mode (auto vs manual)
    let sys = '';
    if (aiTask === 'code') {
      sys = executionMode === 'auto' ? codeAutoSys : codeManualSys;
    } else {
      const baseSys = executionMode === 'auto' ? sshAutoSys : sshManualSys;
      sys = baseSys + '\n' + backgroundTmuxSys + skillBlock;
    }


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

        const res = await llmFetch(relayUserId, 'https://api.groq.com/openai/v1/chat/completions', {
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
      if (isManual) {
        const ssrfCheck = await assertSafeHttpUrl(apiUrl);
        if (!ssrfCheck.safe) {
          return NextResponse.json({ success: false, error: `Invalid or blocked AI endpoint URL: ${ssrfCheck.reason}` }, { status: 400 });
        }
      }
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

              const response = await llmFetch(relayUserId, apiUrl, {
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

            const ssrfCheck = await assertSafeHttpUrl(manualEndpoint);
            if (!ssrfCheck.safe) {
                lastError = new Error(`Invalid or blocked AI endpoint URL: ${ssrfCheck.reason}`);
                break;
            }

            try {
                const response = await llmFetch(relayUserId, manualEndpoint, {
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
                const response = await llmFetch(relayUserId, 'https://api.groq.com/openai/v1/chat/completions', {
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
