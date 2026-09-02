import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ── Dynamic Frontmatter Parsing ────────────────────────────────────
// Extract a single string value from YAML frontmatter
function extractFrontmatter(content, field) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const lineMatch = fmMatch[1].match(new RegExp(`^${field}:\\s*(.*)$`, 'im'));
  if (!lineMatch) return null;
  return lineMatch[1].trim().replace(/^['"]|['"]$/g, '');
}

// Extract array values from YAML frontmatter (e.g. keywords: [a, b, c])
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

// ── Dynamic Skill Scoring ──────────────────────────────────────────
// Score a skill against a query using its dynamically loaded keywords
function scoreSkill(skill, query) {
  const q = query.toLowerCase();
  const skillName = String(skill.name || '').toLowerCase();
  const keywords = skill.keywords || [];
  const description = String(skill.description || '').toLowerCase();
  let score = 0;

  // 1. Keyword matching (from frontmatter)
  for (const kw of keywords) {
    if (q.includes(kw)) score += kw.length; // longer keyword = higher relevance
  }

  // 2. Description matching (weaker signal)
  if (description) {
    const descWords = description.split(/\s+/).filter(w => w.length > 3);
    for (const dw of descWords) {
      if (q.includes(dw)) score += 2;
    }
  }

  // 3. Direct name match (strongest signal)
  const normalizedName = skillName.replace(/[-_]/g, ' ');
  const skillRoot = skillName.replace(/[-_]/g, '');
  if (q.includes(normalizedName) || q.includes(skillName)) {
    score += 50;
  } else {
    // Partial word matching (e.g. "pm2 deployment" → "pm2-deployment")
    const words = normalizedName.split(' ').filter(w => w.length > 2);
    let matchedWords = 0;
    for (const w of words) {
      if (q.includes(w)) {
        score += 10;
        matchedWords++;
      }
    }
    if (matchedWords > 1) score += 20;
  }

  // ── NEGATIVE MATCH: Prevent confusing similar product names ──
  // e.g. user asks for "openclaw" but skill is "zeroclaw" — they share suffix "claw"
  if (score > 0 && skillRoot.length > 4) {
    const queryWords = q.split(/\s+/).filter(w => w.length > 3);
    for (const qw of queryWords) {
      const qwClean = qw.replace(/[-_]/g, '');
      if (qwClean !== skillRoot && qwClean.length > 4) {
        const minLen = Math.min(qwClean.length, skillRoot.length);
        let commonSuffix = 0;
        for (let ci = 1; ci <= minLen; ci++) {
          if (qwClean[qwClean.length - ci] === skillRoot[skillRoot.length - ci]) commonSuffix++;
          else break;
        }
        if (commonSuffix >= 4 && !q.includes(skillRoot)) {
          return 0; // Kill the score — wrong product
        }
      }
    }
  }

  return score;
}

export async function POST(req) {
  try {
    // SECURITY: this route returns file contents from the server filesystem. It
    // previously treated the session as optional and proceeded regardless,
    // relying entirely on the middleware auth gate. Require it here: one matcher
    // regression would otherwise make this an unauthenticated file read.
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch (e) {
      logger.warn('[Skills Local] Session resolution failed:', e.message);
    }
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Skills installed via /api/skills/install are namespaced per user.
    const userId = String(session.user?.id || session.user?.email || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64);

    const { q } = await req.json();
    if (!q) {
      return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 });
    }

    const allSkills = [];

    // Read every *.md in `dir` (non-recursive) into the skill list.
    const loadFromDir = async (dir, source) => {
      let files;
      try {
        files = await readdir(dir);
      } catch (e) {
        return; // directory does not exist — nothing to load
      }
      for (const file of files.filter(f => f.endsWith('.md'))) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const defaultName = file.replace('.md', '');
          const name = extractFrontmatter(content, 'name') || defaultName;
          const description = extractFrontmatter(content, 'description') || '';
          let keywords = extractKeywords(content, 'keywords');
          const tags = extractKeywords(content, 'tags');
          // Merge tags into keywords for broader matching
          if (tags.length > 0) keywords = [...new Set([...keywords, ...tags])];
          // Fallback: use skill name as a keyword
          if (keywords.length === 0) keywords = [name.toLowerCase().replace(/-/g, ' ')];
          allSkills.push({ name, description, content, source, keywords });
        } catch (e) { /* skip unreadable */ }
      }
    };

    // ── Bundled skills shipped with the app (top-level .md only) ──
    await loadFromDir(join(process.cwd(), 'skills'), 'custom');

    // ── Skills this user installed (per-user namespace) ──
    // Only the caller's own namespace is read, so one user cannot have their
    // agent context poisoned by another user's install.
    if (userId) {
      await loadFromDir(join(process.cwd(), 'skills', 'users', userId), 'own');
    }

    // ── Load .agents/skills/ folder (installed from SkillsMP) ──
    try {
      const agentsDir = join(process.cwd(), '.agents', 'skills');
      const entries = await readdir(agentsDir, { withFileTypes: true });
      for (const entry of entries.filter(e => e.isDirectory())) {
        try {
          const dirPath = join(agentsDir, entry.name);
          const mdFiles = (await readdir(dirPath)).filter(f => f.endsWith('.md'));
          if (mdFiles.length > 0) {
            const content = await readFile(join(dirPath, mdFiles[0]), 'utf-8');
            const name = extractFrontmatter(content, 'name') || entry.name;
            const description = extractFrontmatter(content, 'description') || '';
            let keywords = extractKeywords(content, 'keywords');
            const tags = extractKeywords(content, 'tags');
            if (tags.length > 0) keywords = [...new Set([...keywords, ...tags])];
            if (keywords.length === 0) keywords = [name.toLowerCase().replace(/-/g, ' ')];
            allSkills.push({ name, description, content, source: 'installed', keywords });
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* .agents dir doesn't exist */ }

    // ── Score & rank by relevance using dynamic keywords ──
    const scored = allSkills
      .map(s => ({ ...s, score: scoreSkill(s, q) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Deduplicate: prefer higher-scoring variant, max 3
    const seen = new Set();
    const matched = [];
    for (const s of scored) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        matched.push({
          name: s.name,
          description: s.description || '',
          content: s.content.slice(0, 800),
          source: s.source,
          score: s.score,
          keywords: s.keywords,
        });
      }
      if (matched.length >= 3) break;
    }

    return NextResponse.json({
      success: true,
      skills: matched,
      allAvailable: allSkills.map(s => `${s.name}(${s.source})`),
    });
  } catch (error) {
    logger.error('[Skills Local] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
