import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';

// GET /api/deploy/github/branches?repo=owner/repo&project=projectId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const repo = url.searchParams.get('repo');
    const project = url.searchParams.get('project');

    await connectDB(null, true);

    let token = null;
    let resolvedRepo = repo;

    if (project) {
      const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;
      const setting = await SystemSetting.findOne({ key: dbKey });
      const cfg = setting?.value || {};
      if (!resolvedRepo && cfg.githubRepo) resolvedRepo = cfg.githubRepo;
      if (cfg.githubToken) token = cfg.githubToken;
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
    console.error('[deploy/github/branches] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
