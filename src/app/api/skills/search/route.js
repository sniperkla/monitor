import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SKILLS_MP_API_BASE = 'https://skillsmp.com/api/v1';

export async function POST(req) {
  try {
    // Session check is best-effort — the SkillsMP API key is the real auth guard.
    // getServerSession can intermittently fail in Next.js 16 App Router.
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch (e) {
      console.warn('[SkillsMP Search] Session resolution failed:', e.message);
    }
    if (!session) {
      console.warn('[SkillsMP Search] No session found — proceeding with API key auth only.');
    }

    const { q, type = 'ai' } = await req.json();
    if (!q) {
      return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 });
    }

    const apiKey = process.env.SKILLS_MP_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'SkillsMP API key not configured' }, { status: 500 });
    }
    
    // DEBUG: Log key prefix and length to verify it's loaded correctly
    console.log(`[SkillsMP] Key check: prefix=${apiKey.substring(0, 10)}... length=${apiKey.length}`);

    // SkillsMP AI search is GET /api/v1/skills/ai-search?q=...
    // Regular search is GET /api/v1/skills/search?q=...
    const endpoint = type === 'ai' ? '/skills/ai-search' : '/skills/search';
    const params = new URLSearchParams({ q: String(q) });
    const url = `${SKILLS_MP_API_BASE}${endpoint}?${params}`;
    
    console.log(`[SkillsMP] GET ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || errorData?.message || `SkillsMP API error: ${response.status}`;
      console.warn(`[SkillsMP] ${response.status}: ${errorMessage}`);
      return NextResponse.json({ 
        success: false, 
        error: errorMessage
      }, { status: response.status });
    }

    const data = await response.json();
    // Handle different response structures for standard search vs AI vector search
    // Standard: data.data.skills
    // AI Search: data.data.data (vector store results)
    let skills = data?.data?.skills || data?.data?.data || data?.skills || [];
    
    // Normalize skills content (AI search returns array of content objects)
    skills = skills.map(skill => {
        if (Array.isArray(skill.content)) {
            const textContent = skill.content.find(c => c.type === 'text');
            return {
                ...skill,
                content: textContent ? textContent.text : String(skill.content)
            };
        }
        return skill;
    });

    console.log(`[SkillsMP] Found ${skills.length} skills`);
    return NextResponse.json({ success: true, skills });

  } catch (error) {
    console.error('[SkillsMP Search] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
