import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id, name, content } = await req.json();
    if (!id || !name || !content) {
      return NextResponse.json({ success: false, error: 'Missing id, name or content' }, { status: 400 });
    }

    // 1. Ensure skills directory exists
    const skillsDir = join(process.cwd(), 'skills');
    await mkdir(skillsDir, { recursive: true });

    // 2. Save the skill as a Markdown file
    const safeName = name.replace(/[^a-z0-9\-]/gi, '-').toLowerCase();
    const filePath = join(skillsDir, `${safeName}.md`);
    
    // Add skill metadata at the top
    const header = `# ${name}\n\n[Remote ID: ${id} | Source: skillsmp.com]\n\n`;
    await writeFile(filePath, header + content, 'utf-8');

    return NextResponse.json({ 
      success: true, 
      message: `Skill '${name}' installed locally at ${safeName}.md`,
      path: filePath
    });

  } catch (error) {
    console.error('[SkillsMP Install] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
