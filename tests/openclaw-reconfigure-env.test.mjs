// ── Executable regression: OpenClaw "reconfigure" must really write .env ─────
//
// Symptom this reproduces, reported from the UI:
//
//   > Starting Reconfigure OpenClaw...
//   > Connecting to remote server...
//   $ write ~/.openclaw/.env
//   base64: invalid input
//
// Root cause: the command was built as
//
//   `export OC_HOME="${HH}"` + '; echo \'${envPyB64}\' | base64 -d | python3'
//
// The second half is a SINGLE-QUOTED JS string, so `${envPyB64}` was never
// interpolated. The remote shell received the literal text `${envPyB64}`,
// `echo` printed it inside its own single quotes, and `base64 -d` was handed
// `${envPyB64}` — hence "invalid input". The python never ran, ENV_UPDATED was
// never printed, and reconfigure aborted before restarting the gateway.
//
// A regex on the source cannot tell a correct template literal from a plausible-
// looking one, so this test lifts the real command expression out of the route,
// evaluates it the way the runtime would, and RUNS it under `sh -c` against a
// temporary OC_HOME. An uninterpolated placeholder fails loudly here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROUTE = 'src/app/api/agents/openclaw/route.js';
const src = readFileSync(ROUTE, 'utf8');

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

// ── 1. Lift the reconfigure env-writer out of the route ──────────────────────
const callMarker = "await run('write ~/.openclaw/.env',";
const callAt = src.indexOf(callMarker);
assert.ok(callAt > 0, `missing the reconfigure env write in ${ROUTE}`);
const argFrom = callAt + callMarker.length;
const argTo = src.indexOf(', { timeoutMs:', argFrom);
assert.ok(argTo > argFrom, 'could not find the end of the command argument');
const CMD_EXPR = src.slice(argFrom, argTo).trim();

// The python program is generated just above it; take the real one so the test
// exercises the actual upsert logic, not a stand-in.
const pyFrom = src.indexOf('const envPy = [', callAt - 4000);
assert.ok(pyFrom > 0, 'missing the envPy program');
const pyTo = src.indexOf("].join('\\n');", pyFrom);
assert.ok(pyTo > pyFrom, 'could not find the end of envPy');
const PY_EXPR = src.slice(pyFrom + 'const envPy = '.length, pyTo + 1);

// The array holds template literals, so it must be evaluated with the value
// bound — NOT string-substituted. Evaluating is what makes this test able to
// see the difference between a real payload and an uninterpolated placeholder.
const renderPy = new Function('envLinesB64', `return (${PY_EXPR}).join('\\n');`);
const renderPython = (envLines) => renderPy(b64(envLines.join('\n')));

const python = (() => {
  for (const bin of ['python3', 'python']) {
    try {
      execFileSync(bin, ['-c', 'print(1)'], { stdio: 'ignore' });
      return bin;
    } catch { /* try the next interpreter */ }
  }
  return null;
})();

/** Build the exact command string the route ships, with real values bound. */
function renderCommand({ home, envLines }) {
  const envPy = renderPython(envLines);
  const cmd = new Function('HH', 'envPyB64', `return (${CMD_EXPR});`)(
    home,
    b64(envPy),
  );
  return cmd;
}

function runReconfigure(envLines, initial = '') {
  const home = mkdtempSync(path.join(os.tmpdir(), 'openclaw-home-'));
  if (initial !== null) writeFileSync(path.join(home, '.env'), initial);
  const cmd = renderCommand({ home, envLines });
  let out = '';
  let err = null;
  try {
    out = execFileSync('sh', ['-c', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    err = e;
  }
  return { home, cmd, out, err, text: readFileSync(path.join(home, '.env'), 'utf8') };
}

test('the shipped command carries the real payload, not the literal placeholder', () => {
  const cmd = renderCommand({ home: '/tmp/openclaw-instance', envLines: ['FOO=bar'] });
  // THIS is the reported bug. If the argument is (or becomes) a single-quoted
  // string, the placeholder survives all the way to the remote shell and
  // `base64 -d` rejects it with "invalid input".
  assert.doesNotMatch(cmd, /\$\{envPyB64\}/, 'envPyB64 must be interpolated, not shipped literally');
  assert.doesNotMatch(cmd, /\$\{HH\}/, 'HH must be interpolated too');
  assert.match(cmd, /^export OC_HOME="\/tmp\/openclaw-instance";/, 'OC_HOME must be exported from the instance home');
  assert.match(cmd, /echo '[A-Za-z0-9+/=]+' \| base64 -d \| python3/, 'python must come from a decoded stdin payload');
  // The whole thing must be ONE template literal — a `+ '…'` splice is exactly
  // how this broke, so fail if the expression re-acquires one.
  assert.doesNotMatch(CMD_EXPR, /`[^`]*`\s*\+\s*['"]/, 'the command must not be a quoted-string splice');
});

test('reconfigure writes ~/.openclaw/.env and reports ENV_UPDATED', { skip: !python && 'python3 unavailable' }, () => {
  const r = runReconfigure(['OPENROUTER_API_KEY=sk-or-test', 'TELEGRAM_BOT_TOKEN=123:ABC'], null);
  assert.equal(r.err, null, `command failed: ${r.out}`);
  assert.doesNotMatch(r.out, /invalid input/, 'base64 must accept its input');
  assert.match(r.out, /ENV_UPDATED/);
  assert.match(r.text, /^OPENROUTER_API_KEY=sk-or-test$/m);
  assert.match(r.text, /^TELEGRAM_BOT_TOKEN=123:ABC$/m);
});

test('existing keys are replaced in place, unrelated keys and =-values survive', { skip: !python && 'python3 unavailable' }, () => {
  const r = runReconfigure(
    ['OPENROUTER_API_KEY=sk-or-new', 'TELEGRAM_BOT_TOKEN=base64=='],
    'OPENROUTER_API_KEY=sk-or-old\nKEEP_ME=1\nTELEGRAM_BOT_TOKEN=old\n',
  );
  assert.match(r.out, /ENV_UPDATED/);
  assert.equal(r.text.match(/^OPENROUTER_API_KEY=/gm).length, 1, 'no duplicate provider key');
  assert.match(r.text, /^OPENROUTER_API_KEY=sk-or-new$/m);
  assert.match(r.text, /^TELEGRAM_BOT_TOKEN=base64==$/m, 'values containing = must not be truncated');
  assert.match(r.text, /^KEEP_ME=1$/m, 'unrelated credentials are preserved');
  assert.equal(statSync(path.join(r.home, '.env')).mode & 0o777, 0o600, '.env must stay private');
});

test('no other agent route ships an uninterpolated ${…} to the remote shell', () => {
  // Same class of bug, one regex: a `${name}` that sits inside a single- or
  // double-quoted JS string rather than a template literal. openclaw:1002 was
  // the only live instance; this keeps it that way.
  for (const f of ['openclaw', 'zeroclaw', 'nanobot', 'hermes']) {
    const body = readFileSync(`src/app/api/agents/${f}/route.js`, 'utf8');
    const bad = body.match(/\+ *['"][^'"]*\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
    assert.equal(bad, null, `${f} route concatenates an uninterpolated placeholder: ${bad}`);
  }
});
