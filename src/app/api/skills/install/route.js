import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/serverGuard';
import { neutralizeSkillFences } from '@/utils/promptSafety';

export const dynamic = 'force-dynamic';

/** Hard ceiling on a single skill file. */
const MAX_CONTENT_BYTES = 200 * 1024;

/** Installs allowed per user per window (serverGuard window). */
const INSTALL_RATE_LIMIT = 10;

/**
 * Phrases whose only plausible purpose is to override the agent's operating
 * rules. Procedural documentation legitimately contains shell commands, so we
 * deliberately do NOT block on those — we block on instructions aimed at the
 * model itself.
 *
 * Best-effort by nature: this raises the cost of injection, it does not make a
 * hostile skill safe. The real control is containment in promptSafety.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|the\s+foregoing)\s+(?:instructions?|prompts?|rules?|context)/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  /forget\s+(?:all\s+)?(?:your|the)\s+(?:previous\s+)?(?:instructions?|rules?|prompts?)/i,
  /override\s+(?:your|the|all)\s+(?:system\s+)?(?:instructions?|rules?|programming|prompt)/i,
  /\bnew\s+(?:system\s+)?(?:instructions?|prompt)\s*:/i,
  /^\s*(?:system|assistant)\s*:\s*$/im,
  /\bdo\s+not\s+(?:tell|inform|reveal\s+to)\s+the\s+user/i,
];

/**
 * YAML frontmatter is built by string concatenation, so an embedded newline
 * would let a caller inject additional frontmatter keys. Strip control
 * characters and quotes rather than escaping them.
 */
function yamlSafeScalar(value, maxLen = 200) {
  return String(value ?? '')
    .replace(/[\r\n\t\x00-\x1f]/g, ' ')
    .replace(/["'\\]/g, '')
    .trim()
    .slice(0, maxLen);
}

/** Filesystem-safe single path segment. */
function fsSafeSegment(value, maxLen = 64) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, maxLen);
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Skills are namespaced per user, so the session is required to resolve the
    // owner — not merely to authorise the write.
    const rawUserId = session.user?.id || session.user?.email;
    const userId = fsSafeSegment(rawUserId);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rateCheck = checkRateLimit(`skills-install:${userId}`, INSTALL_RATE_LIMIT);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many skill installs. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        },
        { status: 429 }
      );
    }

    const { id, name, content, description } = await req.json();
    if (!id || !name || !content) {
      return NextResponse.json({ success: false, error: 'Missing id, name or content' }, { status: 400 });
    }

    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      return NextResponse.json({ success: false, error: 'Content too large' }, { status: 413 });
    }

    // Reject content whose only plausible purpose is to override agent rules.
    const injectionHit = INJECTION_PATTERNS.find((re) => re.test(content));
    if (injectionHit) {
      logger.warn('[Skills Install] Rejected content matching injection pattern', {
        userId,
        pattern: String(injectionHit),
        name: String(name).slice(0, 80),
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Rejected: skill content contains instructions that attempt to override the agent.',
        },
        { status: 400 }
      );
    }

    const safeName = String(name).replace(/[^a-z0-9\-]/gi, '-').toLowerCase().slice(0, 80);
    if (!safeName) {
      return NextResponse.json({ success: false, error: 'Invalid skill name' }, { status: 400 });
    }

    // Per-user namespace. Previously every install landed in the shared skills/
    // directory, which every other user's session would then load.
    const skillsDir = join(process.cwd(), 'skills', 'users', userId);
    await mkdir(skillsDir, { recursive: true });

    // Strip fence markers at write time too: promptSafety fences this content
    // before it reaches the model, and a marker baked into the stored file
    // would let a skill close the fence early.
    const storedContent = neutralizeSkillFences(content);

    const hasFrontmatter = /^---\n[\s\S]*?\n---/.test(storedContent.trim());
    let finalContent;
    if (hasFrontmatter) {
      finalContent = storedContent;
    } else {
      const desc = yamlSafeScalar(description);
      const safeId = yamlSafeScalar(id, 120);
      const safeSkillName = yamlSafeScalar(name, 80);
      const frontmatter =
        `---\nname: ${safeSkillName}` +
        (desc ? `\ndescription: "${desc}"` : '') +
        `\nkeywords: [${safeSkillName.toLowerCase().replace(/[-_]/g, ', ')}]` +
        `\nsource: skillsmp\nremote_id: ${safeId}\nowner: ${userId}\n---\n\n`;
      finalContent = frontmatter + storedContent;
    }

    await writeFile(join(skillsDir, `${safeName}.md`), finalContent, 'utf-8');

    // Audit trail: who installed what, plus a hash so stored bytes can be
    // matched to a report later without logging the content itself.
    const contentHash = createHash('sha256').update(finalContent, 'utf8').digest('hex').slice(0, 16);
    logger.info('[Skills Install] Installed', {
      userId,
      skill: safeName,
      bytes: Buffer.byteLength(finalContent, 'utf8'),
      sha256_16: contentHash,
    });

    // NOTE: the absolute filesystem path is deliberately no longer returned.
    return NextResponse.json({
      success: true,
      message: `Skill '${safeName}' installed.`,
      skill: safeName,
    });
  } catch (error) {
    logger.error('[SkillsMP Install] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
