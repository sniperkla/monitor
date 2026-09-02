// ── Regression test: /api/skills/install must refuse undeclared body fields ──
//
// Context: a scanner report claimed an "installPath arbitrary file write" in
// this route, citing 200 {"success":true} for eight path-shaped aliases
// (installPath, path, file, target, directory, dest, destination, location) as
// proof of a write to /etc/cron.d/. That was a false positive — the route never
// read any of those fields, and the write target is built server-side — but the
// 200 responses were genuinely misleading: they made an ignored parameter look
// accepted, which is exactly why the finding was reported as confirmed.
//
// The fix is a strict allowlist on the request body. It is not closing an
// active hole; it is making the contract explicit so that:
//   - a path-shaped parameter can never travel through the handler unnoticed;
//   - a future change that starts honouring one has to declare it here first;
//   - probes are answered with 400 instead of a 200 that reads as success.
//
// These are source contracts, not runtime imports: exercising the route needs a
// Next request context, a session and a live database. They assert the parts
// that would actually regress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/api/skills/install/route.js', import.meta.url), 'utf8');

/** The allowlist as declared in the route. */
function allowedFields() {
  const m = src.match(/ALLOWED_BODY_FIELDS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'could not find the ALLOWED_BODY_FIELDS allowlist in the install route');
  return new Set([...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
}

test('the body allowlist is exactly the four fields the UI sends', () => {
  assert.deepEqual(
    [...allowedFields()].sort(),
    ['content', 'description', 'id', 'name'],
    'TerminalView.handleInstallSkill sends id/name/description/content and nothing else; ' +
      'widening this set re-opens the surface the allowlist exists to close'
  );
});

test('no path-shaped field is accepted', () => {
  const allowed = allowedFields();
  const PATH_SHAPED = [
    'installPath',
    'path',
    'file',
    'target',
    'directory',
    'dest',
    'destination',
    'location',
    'filename',
    'filepath',
    'dir',
    'outfile',
  ];
  const leaked = PATH_SHAPED.filter((f) => allowed.has(f));
  assert.deepEqual(leaked, [], `these path-shaped fields are accepted: ${leaked.join(', ')}`);
});

test('undeclared fields are rejected with 400, not ignored', () => {
  // The check must exist...
  assert.match(
    src,
    /Object\.keys\(body\s*\|\|\s*\{\}\)\.filter\(\s*\(k\)\s*=>\s*!ALLOWED_BODY_FIELDS\.has\(k\)\s*\)/,
    'expected the unknown-field check against ALLOWED_BODY_FIELDS'
  );
  // ...and must actually short-circuit rather than log-and-continue.
  const idx = src.indexOf('unknownFields.length');
  assert.ok(idx > -1, 'expected a branch on unknownFields.length');
  const after = src.slice(idx, idx + 900);
  assert.match(after, /status:\s*400/, 'the unexpected-field branch must return 400');
  assert.match(after, /auditLog\(/, 'the unexpected-field branch must record an audit event');
});

test('the rejection is audited without storing attacker-controlled values', () => {
  // Values could be large or hostile; only field names may be persisted.
  const idx = src.indexOf("reason: 'unexpected_fields'");
  assert.ok(idx > -1, 'expected an auditLog detail with reason unexpected_fields');
  const block = src.slice(idx, idx + 500);
  assert.match(block, /fields:/, 'expected the rejected field names in the audit detail');
  assert.doesNotMatch(
    block,
    /body\[|unknownValues|Object\.values\(body/,
    'audit detail must not persist attacker-supplied values, only field names'
  );
});

test('the write destination stays server-derived', () => {
  // The property the false positive got wrong: no request field contributes to
  // the path. If this ever interpolates `body`, the allowlist is no longer
  // sufficient on its own.
  assert.match(
    src,
    /join\(\s*process\.cwd\(\)\s*,\s*['"]skills['"]\s*,\s*['"]users['"]\s*,\s*userId\s*\)/,
    'skills must be written to join(process.cwd(), "skills", "users", userId)'
  );
  const filename = src.match(/join\(\s*skillsDir\s*,\s*([^)]+)\)/);
  assert.ok(filename, 'could not find the filename construction');
  assert.doesNotMatch(
    filename[1],
    /\bbody\b|\bpath\b|\binstallPath\b/,
    `the filename must not come from the request body; got: ${filename[1]}`
  );
});
