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

// GET /api/deploy/bitbucket/branches?repo=workspace/repo-slug&project=projectId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    let repo = url.searchParams.get('repo');
    const project = url.searchParams.get('project');
    repo = normalizeRepoParam(repo);

    await connectDB(process.env.MONGODB_URI, true);

    let credentials = null;

    if (project) {
      const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;
      const setting = await SystemSetting.findOne({ key: dbKey });
      const cfg = setting?.value || {};

      if (!repo && cfg.bitbucketRepo) repo = cfg.bitbucketRepo;

      if (cfg.bitbucketUsername && cfg.bitbucketAppPassword) {
        try {
          let u = decrypt(cfg.bitbucketUsername);
          const p = decrypt(cfg.bitbucketAppPassword);
          if (p.startsWith('ATAT')) {
            u = 'x-token-auth';
          }
          credentials = Buffer.from(`${u}:${p}`).toString('base64');
        } catch (err) {
          console.warn('[deploy/bitbucket/branches] failed to decrypt credentials', err.message);
        }
      }
    }

    if (!repo) {
      return NextResponse.json({ success: false, error: 'Missing repo (workspace/repo-slug) parameter' }, { status: 400 });
    }

    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repo}/refs/branches?pagelen=100`;

    const headers = { Accept: 'application/json' };
    if (credentials) headers.Authorization = `Basic ${credentials}`;

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `Bitbucket API error: ${res.status} ${text}` }, { status: 502 });
    }

    const data = await res.json();
    const branches = Array.isArray(data.values) ? data.values.map(b => b.name) : [];

    return NextResponse.json({ success: true, branches });
  } catch (error) {
    console.error('[deploy/bitbucket/branches] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
