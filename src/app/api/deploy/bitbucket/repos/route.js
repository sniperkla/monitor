import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { decrypt } from '@/utils/encryption';

// GET /api/deploy/bitbucket/repos?project=projectId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = session.user?.id || session.user?.sub || session.user?.email || 'global';

    const url = new URL(request.url);
    const project = url.searchParams.get('project') || 'default';
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;

    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ userId: { $in: [userId, 'global'] }, key: dbKey });
    const cfg = setting?.value || {};

    if (!cfg.bitbucketUsername || !cfg.bitbucketAppPassword) {
      return NextResponse.json({ success: false, error: 'Bitbucket not connected' }, { status: 400 });
    }

    let credentials;
    try {
      const u = decrypt(cfg.bitbucketUsername);
      const p = decrypt(cfg.bitbucketAppPassword);
      credentials = Buffer.from(`${u}:${p}`).toString('base64');
    } catch (err) {
      return NextResponse.json({ success: false, error: 'Failed to decrypt Bitbucket credentials' }, { status: 500 });
    }

    const repos = [];
    let pageUrl = 'https://api.bitbucket.org/2.0/repositories?role=member&pagelen=50&sort=-updated_on';

    while (pageUrl && repos.length < 200) {
      const res = await fetch(pageUrl, {
        headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ success: false, error: `Bitbucket API error: ${res.status} ${text}` }, { status: 502 });
      }
      const data = await res.json();
      if (Array.isArray(data.values)) {
        for (const r of data.values) {
          repos.push({
            slug: r.full_name || `${r.workspace?.slug || r.owner?.display_name}/${r.slug}`,
            name: r.name || r.slug,
            updated: r.updated_on || '',
            isPrivate: r.is_private ?? true,
          });
        }
      }
      pageUrl = data.next || null;
    }

    return NextResponse.json({ success: true, repos });
  } catch (error) {
    console.error('[deploy/bitbucket/repos] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
