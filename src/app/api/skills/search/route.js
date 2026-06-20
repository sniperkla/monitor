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

    const { q, type = 'smart' } = await req.json();
    if (!q) {
      return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 });
    }

    const apiKey = process.env.SKILLS_MP_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'SkillsMP API key not configured' }, { status: 500 });
    }
    
    // DEBUG: Log key prefix and length to verify it's loaded correctly
    console.log(`[SkillsMP] Key check: configured=${!!apiKey}, length=${apiKey.length}`);

    // 'smart' mode: use Groq to extract concise keywords, then call normal keyword search
    // 'ai' mode: use SkillsMP AI vector search (hits rate limit)
    // anything else: normal keyword search with raw query
    let searchQuery = String(q);

    if (type === 'smart') {
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        try {
          const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${groqKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'llama-3.1-8b-instant',
              messages: [{
                role: 'system',
                content: 'You are a search query optimizer. Your job is to extract 1-2 highly specific technical keywords from a user goal. Do NOT include words like "marketplace", "skills", "DevOps", "fix", "help", or "goal". Return ONLY the technical terms, space-separated.'
              }, {
                role: 'user',
                content: `Extract the core technical keywords from this goal.
Examples:
Goal: fix nginx 502 error
Keywords: nginx

Goal: deploy react to aws
Keywords: react aws

Goal: ${q}
Keywords:`
              }],
              max_tokens: 15,
              temperature: 0,
            }),
          });
          if (groqRes.ok) {
            const groqData = await groqRes.json();
            const extracted = groqData?.choices?.[0]?.message?.content?.trim();
            if (extracted) {
              searchQuery = extracted;
              console.log(`[SkillsMP] Smart keywords: "${searchQuery}" (from: "${q}")`);
            }
          } else {
             const groqErr = await groqRes.json().catch(() => ({}));
             if (groqRes.status === 401) {
               console.warn('[SkillsMP] Groq 401: Invalid API Key. Falling back to raw query.');
             } else {
               console.warn(`[SkillsMP] Groq ${groqRes.status}: ${groqErr?.error?.message || 'Unknown error'}`);
             }
          }
        } catch (e) {
          console.warn('[SkillsMP] Keyword extraction failed, using raw query:', e.message);
        }
      }
    }

    const endpoint = type === 'ai' ? '/skills/ai-search' : '/skills/search';
    const params = new URLSearchParams({ q: searchQuery });
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
    
    // Normalize skills content (AI search returns array of content objects vs standard search having a single 'content' or 'markdown' field)
    skills = skills.map(item => {
        // For AI Search, the data is usually wrapped inside a 'skill' property
        const s = item.skill ? item.skill : item;
        
        let content = item.content || s.content || item.markdown || s.markdown || item.md_content || s.md_content || '';
        if (Array.isArray(content)) {
            const textContent = content.find(c => c.type === 'text');
            content = textContent ? textContent.text : String(content);
        }
        return {
            id: s.id || s._id || s.slug || item.file_id || '', // Ensure we have a valid ID
            name: s.name || s.title || 'Untitled Skill',
            description: s.description || s.summary || '',
            stars: s.stars || item.stars || 0,
            version: s.version || item.version || '1.0.0',
            content: content // Ensure content is always mapped correctly
        };
    });

    console.log(`[SkillsMP] Found ${skills.length} skills`);
    return NextResponse.json({ success: true, skills });

  } catch (error) {
    console.error('[SkillsMP Search] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
