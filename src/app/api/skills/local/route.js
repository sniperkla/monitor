import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

// Keyword map for matching skills to goals
const KEYWORD_MAP = {
  'docker': ['docker', 'container', 'image', 'dockerfile', 'docker-compose', 'compose'],
  'nginx': ['nginx', 'reverse proxy', 'upstream', 'proxy_pass', 'web server'],
  'nginx-fail-recovery': ['nginx', 'fail', 'failure', 'nginx failed', 'nginx not working', 'nginx error', 'nginx restart', 'nginx permission', 'nginx config error', 'nginx journal', 'nginx recovery', 'nginx broken', 'nginx troubleshoot', 'nginx check'],
  'pm2-deployment': ['pm2', 'deploy', 'node', 'npm', 'yarn', 'next.js', 'express', 'ecosystem'],
  'ssl-certificates': ['ssl', 'tls', 'certificate', 'https', 'letsencrypt', 'certbot'],
  'firewall-management': ['firewall', 'port', 'ufw', 'firewalld', 'iptables', 'allow', 'deny'],
  'database': ['mysql', 'postgres', 'mongodb', 'redis', 'sql', 'database', 'db'],
  'git': ['git', 'commit', 'branch', 'merge', 'clone', 'pull', 'push'],
  'ssh': ['ssh', 'ssh-key', 'sshd', 'remote access', 'authorized_keys'],
  'troubleshooting': ['error', 'fail', 'crash', 'debug', 'troubleshoot', 'not working', 'broken'],
};

function scoreSkill(skillName, query) {
  const q = query.toLowerCase();
  const keywords = KEYWORD_MAP[skillName] || [];
  let score = 0;
  for (const kw of keywords) {
    if (q.includes(kw)) score += kw.length; // longer keyword match = higher relevance
  }
  
  const normalizedName = skillName.toLowerCase().replace(/[-_]/g, ' ');
  const skillRoot = skillName.toLowerCase().replace(/[-_]/g, '');
  // Direct name match
  if (q.includes(normalizedName) || q.includes(skillName.toLowerCase())) {
    score += 50;
  } else {
    // Partial word matching (crucial for skills like "openclaw-install" vs user input "install openclaw")
    const words = normalizedName.split(' ').filter(w => w.length > 2);
    let matchedWords = 0;
    for (const w of words) {
        if (q.includes(w)) {
            score += 10;
            matchedWords++;
        }
    }
    // Boost if multiple words match
    if (matchedWords > 1) {
        score += 20;
    }
  }

  // ── NEGATIVE MATCH: Prevent confusing similar product names ──
  // e.g. user asks for "openclaw" but skill is "zeroclaw" — they share suffix "claw"
  // but are different products. Suppress the match.
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
        // If they share a 4+ char suffix but are different words → wrong product
        if (commonSuffix >= 4 && !q.includes(skillRoot)) {
          return 0; // Kill the score
        }
      }
    }
  }

  return score;
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { q } = await req.json();
    if (!q) {
      return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 });
    }

    const allSkills = [];

    // Load custom skills/ folder
    try {
      const skillsDir = join(process.cwd(), 'skills');
      const files = await readdir(skillsDir);
      for (const file of files.filter(f => f.endsWith('.md'))) {
        try {
          const content = await readFile(join(skillsDir, file), 'utf-8');
          const name = file.replace('.md', '');
          allSkills.push({ name, content, source: 'custom' });
        } catch (e) { /* skip unreadable */ }
      }
    } catch (e) { /* skills dir doesn't exist */ }

    // Load .agents/skills/ folder (installed from SkillsMP)
    try {
      const agentsDir = join(process.cwd(), '.agents', 'skills');
      const entries = await readdir(agentsDir, { withFileTypes: true });
      for (const entry of entries.filter(e => e.isDirectory())) {
        try {
          const dirPath = join(agentsDir, entry.name);
          const mdFiles = (await readdir(dirPath)).filter(f => f.endsWith('.md'));
          if (mdFiles.length > 0) {
            const content = await readFile(join(dirPath, mdFiles[0]), 'utf-8');
            allSkills.push({ name: entry.name, content, source: 'installed' });
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* .agents dir doesn't exist */ }

    // Score & rank by relevance to the query
    const scored = allSkills
      .map(s => ({ ...s, score: scoreSkill(s.name, q) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Deduplicate: prefer higher-scoring variant when names share a prefix, max 3
    const seen = new Set();
    const matched = [];
    for (const s of scored) {
      // Use full name as dedup key — skills with different suffixes (nginx vs nginx-fail-recovery)
      // are distinct and should both be included
      if (!seen.has(s.name)) {
        seen.add(s.name);
        matched.push({ name: s.name, content: s.content.slice(0, 800), source: s.source, score: s.score });
      }
      if (matched.length >= 3) break;
    }

    return NextResponse.json({
      success: true,
      skills: matched,
      allAvailable: allSkills.map(s => `${s.name}(${s.source})`),
    });
  } catch (error) {
    console.error('[Skills Local] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
