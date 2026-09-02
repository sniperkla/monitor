import { test } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for the skill id validation logic in /api/skills/install.
 *
 * The validation function is not exported from the route module (Next.js route
 * files don't export individual functions beyond the HTTP handlers), so we
 * replicate the exact validation logic here and test it directly. If the
 * route file's logic changes, these tests should be updated to match.
 */

function validateSkillId(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 120) return null;
  if (cleaned.startsWith('.')) return null;
  if (/[/\\]/.test(cleaned)) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) return null;
  return cleaned;
}

test('validateSkillId: accepts simple alphanumeric id', () => {
  assert.strictEqual(validateSkillId('my-skill-123'), 'my-skill-123');
});

test('validateSkillId: accepts underscores', () => {
  assert.strictEqual(validateSkillId('my_skill_name'), 'my_skill_name');
});

test('validateSkillId: accepts mixed case', () => {
  assert.strictEqual(validateSkillId('MySkill-Name'), 'MySkill-Name');
});

test('validateSkillId: trims whitespace', () => {
  assert.strictEqual(validateSkillId('  valid-id  '), 'valid-id');
});

test('validateSkillId: rejects path traversal (../)', () => {
  assert.strictEqual(validateSkillId('../etc/passwd'), null);
  assert.strictEqual(validateSkillId('..'), null);
});

test('validateSkillId: rejects absolute path (/app/next.config.js)', () => {
  assert.strictEqual(validateSkillId('/app/next.config.js'), null);
  assert.strictEqual(validateSkillId('/app/.env'), null);
});

test('validateSkillId: rejects dotfile (.env)', () => {
  assert.strictEqual(validateSkillId('.env'), null);
  assert.strictEqual(validateSkillId('.gitignore'), null);
});

test('validateSkillId: rejects backslash paths', () => {
  assert.strictEqual(validateSkillId('C:\\Windows\\system32'), null);
  assert.strictEqual(validateSkillId('foo\\bar'), null);
});

test('validateSkillId: rejects forward slash', () => {
  assert.strictEqual(validateSkillId('foo/bar'), null);
  assert.strictEqual(validateSkillId('a/b/c'), null);
});

test('validateSkillId: rejects dots in the middle', () => {
  assert.strictEqual(validateSkillId('next.config.js'), null);
  assert.strictEqual(validateSkillId('file.txt'), null);
});

test('validateSkillId: rejects spaces', () => {
  assert.strictEqual(validateSkillId('my skill'), null);
});

test('validateSkillId: rejects special characters', () => {
  assert.strictEqual(validateSkillId('skill@name'), null);
  assert.strictEqual(validateSkillId('skill#name'), null);
  assert.strictEqual(validateSkillId('skill$name'), null);
  assert.strictEqual(validateSkillId('skill%name'), null);
  assert.strictEqual(validateSkillId('skill&name'), null);
  assert.strictEqual(validateSkillId('skill!name'), null);
});

test('validateSkillId: rejects empty string', () => {
  assert.strictEqual(validateSkillId(''), null);
  assert.strictEqual(validateSkillId('   '), null);
});

test('validateSkillId: rejects non-string types', () => {
  assert.strictEqual(validateSkillId(null), null);
  assert.strictEqual(validateSkillId(undefined), null);
  assert.strictEqual(validateSkillId(123), null);
  assert.strictEqual(validateSkillId({}), null);
  assert.strictEqual(validateSkillId([]), null);
});

test('validateSkillId: rejects id longer than 120 chars', () => {
  const longId = 'a'.repeat(121);
  assert.strictEqual(validateSkillId(longId), null);
  const okId = 'a'.repeat(120);
  assert.strictEqual(validateSkillId(okId), okId);
});

test('validateSkillId: rejects newline injection', () => {
  assert.strictEqual(validateSkillId('skill\nname'), null);
  assert.strictEqual(validateSkillId('skill\rname'), null);
  assert.strictEqual(validateSkillId('skill\tname'), null);
});

test('validateSkillId: rejects null byte', () => {
  assert.strictEqual(validateSkillId('skill\x00name'), null);
});

test('validateSkillId: accepts single char', () => {
  assert.strictEqual(validateSkillId('a'), 'a');
});

test('validateSkillId: accepts all-hyphen (edge case)', () => {
  // Technically valid per the regex, though the route also validates the name
  // separately. The id is only used as frontmatter metadata.
  assert.strictEqual(validateSkillId('---'), '---');
});
