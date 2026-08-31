// ── Executable regression: Hermes .env upsert must keep EVERY credential ────
//
// Symptom this reproduces: a one-click install with OpenRouter + Telegram
// produced a remote ~/.hermes/.env containing ONLY TELEGRAM_BOT_TOKEN. The
// previous generated-shell upsert escaped awk's record variable, so awk failed
// and each iteration replaced .env with an empty temp file plus one line.
//
// The server now owns a single Python upsert program (buildEnvUpsertPy) shared
// by install and reconfigure. This test renders that program, runs it against a
// temporary .env, and asserts the real on-disk result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Load buildEnvUpsertPy without pulling in the Next.js/SSH imports the route
// needs at module scope.
const routeSrc = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
const start = routeSrc.indexOf('export function buildEnvUpsertPy');
const end = routeSrc.indexOf('\n}\n', start);
assert.ok(start > -1 && end > start, 'buildEnvUpsertPy must exist in the hermes route');
const modPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'env-upsert-')), 'fn.mjs');
writeFileSync(modPath, routeSrc.slice(start, end + 3));
const { buildEnvUpsertPy } = await import(`file://${modPath}`);

const python = (() => {
  for (const bin of ['python3', 'python']) {
    try {
      execFileSync(bin, ['-c', 'print(1)'], { stdio: 'ignore' });
      return bin;
    } catch { /* try the next interpreter */ }
  }
  return null;
})();

function applyUpsert(entries, initial = '') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
  const envPath = path.join(dir, '.env');
  if (initial !== null) writeFileSync(envPath, initial);
  const script = buildEnvUpsertPy(entries);
  const out = execFileSync(python, ['-c', script], {
    env: { ...process.env, HERMES_HOME: dir },
    encoding: 'utf8',
  });
  return { text: readFileSync(envPath, 'utf8'), out };
}

test('provider key and messenger token both survive the same install write', { skip: !python && 'python3 unavailable' }, () => {
  const { text, out } = applyUpsert([
    ['OPENROUTER_API_KEY', 'sk-or-test'],
    ['TELEGRAM_BOT_TOKEN', '123:ABC'],
    ['TELEGRAM_ALLOWED_USERS', '42'],
  ]);
  assert.match(out, /ENV_UPDATED/);
  const keys = text.split('\n').filter(Boolean).map(l => l.split('=')[0]);
  assert.deepEqual(keys, ['OPENROUTER_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS']);
  assert.match(text, /^OPENROUTER_API_KEY=sk-or-test$/m, 'the OpenRouter key must be persisted');
  assert.match(text, /^TELEGRAM_BOT_TOKEN=123:ABC$/m);
});

test('existing keys are replaced once, unrelated keys are preserved, values with = are intact', { skip: !python && 'python3 unavailable' }, () => {
  const { text } = applyUpsert(
    [['OPENROUTER_API_KEY', 'sk-or-new'], ['TELEGRAM_BOT_TOKEN', 'base64==']],
    'OPENROUTER_API_KEY=sk-or-old\nOPENROUTER_API_KEY=sk-or-stale\nKEEP_ME=1\nTELEGRAM_BOT_TOKEN=old\n',
  );
  assert.equal(text.match(/^OPENROUTER_API_KEY=/gm).length, 1, 'no duplicate/stale provider keys');
  assert.match(text, /^OPENROUTER_API_KEY=sk-or-new$/m);
  assert.match(text, /^TELEGRAM_BOT_TOKEN=base64==$/m, 'values containing = must not be truncated');
  assert.match(text, /^KEEP_ME=1$/m, 'unrelated credentials are preserved');
});

test('.env is written with private permissions', { skip: !python && 'python3 unavailable' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
  writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=old\n');
  execFileSync(python, ['-c', buildEnvUpsertPy([['OPENROUTER_API_KEY', 'sk-or-test']])], {
    env: { ...process.env, HERMES_HOME: dir },
  });
  assert.equal(statSync(path.join(dir, '.env')).mode & 0o777, 0o600);
});
