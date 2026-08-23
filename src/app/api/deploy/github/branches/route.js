import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { decrypt } from '@/utils/encryption';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

function normalizeRepoParam(value) {
  if (!value) return '';
  const raw = value.trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      if (parsed.hostname.toLowerCase().includes('github.com')) {
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return `${parts[0]}/${parts[1]}`;
        }
      }
    }
  } catch (err) {
    // fall back to plain text
  }
  return raw.replace(/^\/+|\/+$/g, '');
}

// GET /api/deploy/github/branches?repo=owner/repo&project=projectId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const url = new URL(request.url);
    let repo = url.searchParams.get('repo');
    const project = url.searchParams.get('project');
    repo = normalizeRepoParam(repo);

    await connectDB(process.env.MONGODB_URI, true);

    let token = null;
    let resolvedRepo = repo;

    if (project) {
      const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;
      const userIdQuery = resolveUserIdQuery(userId);
      const setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
      const cfg = setting?.value || {};
      if (!resolvedRepo && cfg.githubRepo) resolvedRepo = cfg.githubRepo;
      if (cfg.githubToken) {
        try {
          token = decrypt(cfg.githubToken);
          // If decryption returns the raw ciphertext (bad decrypt), discard it
          if (token && token.includes(':') && token.length > 40) {
            token = null;
          }
        } catch (err) {
          logger.warn('[deploy/github/branches] failed to decrypt githubToken — proceeding without auth:', err.message);
          token = null;
        }
      }
    }

    // Allow passing token via header for convenience
    const headerToken = request.headers.get('x-github-token');
    if (headerToken) token = headerToken;

    if (!resolvedRepo) {
      return NextResponse.json({ success: false, error: 'Missing repo (owner/repo) parameter' }, { status: 400 });
    }

    const apiUrl = `https://api.github.com/repos/${resolvedRepo}/branches?per_page=100`;

    const headers = {
      'User-Agent': 'monitor-app',
      Accept: 'application/vnd.github+json'
    };
    if (token) headers.Authorization = `token ${token}`;

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `GitHub API error: ${res.status} ${text}` }, { status: 502 });
    }

    const data = await res.json();
    const branches = Array.isArray(data) ? data.map(b => b.name) : [];

    return NextResponse.json({ success: true, branches });
  } catch (error) {
    logger.error('[deploy/github/branches] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
