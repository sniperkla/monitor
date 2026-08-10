import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { decrypt } from '@/utils/encryption';

function normalizeRepoParam(value) {
  if (!value) return '';
  const raw = value.trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      if (parsed.hostname.toLowerCase().includes('bitbucket.org')) {
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return `${parts[0]}/${parts[1]}`;
        }
      }
    }
  } catch (err) {}
  return raw.replace(/^\/+|\/+$/g, '');
}

// GET /api/deploy/bitbucket/commits?repo=workspace/repo-slug&project=projectId&branch=main
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = session.user?.id || session.user?.sub || session.user?.email || 'global';

    const url = new URL(request.url);
    let repo = url.searchParams.get('repo');
    const project = url.searchParams.get('project');
    const branch = url.searchParams.get('branch') || 'main';
    repo = normalizeRepoParam(repo);

    await connectDB(process.env.MONGODB_URI, true);

    let credentials = null;

    if (project) {
      const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;
      const setting = await SystemSetting.findOne({ userId: { $in: [userId, 'global'] }, key: dbKey });
      const cfg = setting?.value || {};

      if (!repo && cfg.bitbucketRepo) repo = cfg.bitbucketRepo;

      if (cfg.bitbucketUsername && cfg.bitbucketAppPassword) {
        try {
          const u = decrypt(cfg.bitbucketUsername);
          const p = decrypt(cfg.bitbucketAppPassword);
          credentials = Buffer.from(`${u}:${p}`).toString('base64');
        } catch (err) {
          console.warn('[deploy/bitbucket/commits] failed to decrypt credentials', err.message);
        }
      }
    }

    if (!repo) {
      return NextResponse.json({ success: false, error: 'Missing repo (workspace/repo-slug) parameter' }, { status: 400 });
    }

    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repo}/commits/${branch}?pagelen=20`;

    const headers = { Accept: 'application/json' };
    if (credentials) headers.Authorization = `Basic ${credentials}`;

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `Bitbucket API error: ${res.status} ${text}` }, { status: 502 });
    }

    const data = await res.json();
    const commits = Array.isArray(data.values) ? data.values.map(c => ({
      sha: c.hash?.substring(0, 7),
      fullSha: c.hash,
      message: c.message?.split('\n')[0]?.substring(0, 100) || '',
      author: c.author?.user?.display_name || c.author?.raw || '',
      date: c.date || '',
      avatar: c.author?.user?.links?.avatar?.href || ''
    })) : [];

    return NextResponse.json({ success: true, commits });
  } catch (error) {
    console.error('[deploy/bitbucket/commits] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
