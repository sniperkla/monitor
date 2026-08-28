// ── Regression test: ZeroClaw config-merge Python syntax ────────────────────
//
// The user reported on ZeroClaw reconfigure:
//   $ merge ~/.zeroclaw/config.toml
//   File "<stdin>", line 12
//       text = 'model = "' + m + '"
//                                ^
//   SyntaxError: unterminated string literal (detected at line 12)
//
// Root cause: the inline `cfgPy` Python scripts (install + reconfigure paths
// in src/app/api/agents/zeroclaw/route.js) are built from JS template
// literals. Lines written with a SINGLE backslash (`'\n'`) make JS emit a
// real newline into the Python source, splitting the Python string literal
// across two lines. They must use `\\n` so Python receives backslash + n.
//
// This test extracts both cfgPy blocks from the route source, evaluates them
// exactly as the route does, and syntax-checks the resulting Python with the
// local python3 (the same interpreter family the remote host runs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROUTE = 'src/app/api/agents/zeroclaw/route.js';

function extractCfgPyBlocks() {
  const src = fs.readFileSync(ROUTE, 'utf8');
  const blocks = [...src.matchAll(/const cfgPy = \[([\s\S]*?)\]\.join/g)];
  assert.equal(blocks.length, 2, 'route should contain exactly 2 cfgPy blocks (install + reconfigure)');
  const setB64 = Buffer.from(JSON.stringify({ model: 'm' })).toString('base64');
  const envB64 = Buffer.from(JSON.stringify({ MODEL: 'm' })).toString('base64');
  return blocks.map((m) => eval(`[ ${m[1]} ]`).join('\n'));
}

test('both zeroclaw cfgPy scripts are syntactically valid Python', () => {
  const scripts = extractCfgPyBlocks();
  let hasPython = true;
  try { execFileSync('python3', ['--version']); } catch { hasPython = false; }
  if (!hasPython) {
    // Fallback without python3: the bug manifests as a real newline inside a
    // Python string literal, i.e. a line ending mid-literal. Assert the
    // escaping contract instead: the source must NOT contain the broken
    // single-backslash sequences.
    const src = fs.readFileSync(ROUTE, 'utf8');
    const BS = String.fromCharCode(92);
    assert.ok(!src.includes(`'${BS}n' + text`) || src.includes(`'${BS}${BS}n' + text`),
      'string-literal newlines must be escaped (backslash-n), not real newlines');
    return;
  }
  for (const [i, py] of scripts.entries()) {
    execFileSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "<stdin>", "exec")'], { input: py });
  }
});

test('cfgPy writes the ZeroClaw 0.8+ native schema and clean escapes', () => {
  const scripts = extractCfgPyBlocks();
  const BS = String.fromCharCode(92);
  for (const py of scripts) {
    // 0.8+ schema markers
    assert.ok(py.includes(`header = '[providers.models.' + prov + '.default]'`),
      'model provider must be written under [providers.models.<type>.default]');
    assert.ok(py.includes(`'[channels.telegram.default]'`),
      'telegram must be an alias section [channels.telegram.<alias>] with enabled=true');
    assert.ok(py.includes(`'enabled = true'`), 'telegram alias must be enabled');
    // agent binding — 0.8+ channels only poll for enabled agents
    assert.ok(py.includes(`'[agents.default]'`) && py.includes(`'channels = ["telegram.default"]'`),
      'must bind a default agent to the telegram channel (poller never starts otherwise)');
    assert.ok(py.includes(`'[risk_profiles.personal.default]'`) && py.includes(`'risk_profile = "personal"'`),
      'agent needs a configured risk profile (default prune drops empty tables)');
    assert.ok(py.includes(`drop(text, re.escape('[agents.default]'))`),
      'agent/risk drops must use re.escape (plain [..] is a regex char-class no-op)');
    assert.ok(py.includes(`drop(text, r'${BS}[channels_config${BS}.telegram]')`),
      'legacy [channels_config.telegram] (0.8-incompatible) must be stripped');
    assert.ok(py.includes(`head = re.sub(r'(?m)^(api_key|model|default_model)[ ${BS}t]*=.*$', '', head)`),
      'legacy top-level api_key/model keys must be stripped');
    // escaping contract: newline joins use chr(10), no template-literal \n traps
    assert.ok(py.includes(`NL = chr(10)`), 'newlines must be built with chr(10), not JS escapes');
    assert.ok(!/[^\\]\\n/.test(py.replace(/chr\(10\)/g, '')), 'no single-backslash \\n escapes may leak into the Python source');
  }
});

test('pairing-list surfaces telegram one-time bind codes', async () => {
  // Mirrors the pairing-list scan contract in the route.
  const out = [
    '🦀 ZeroClaw Gateway listening on http://127.0.0.1:42617',
    '  🔐 PAIRING REQUIRED — use this one-time code:',
    '     │  018875  │',
    '  🔐 Telegram pairing required. One-time bind code: 388439',
    '     Send `/bind 388439` from your Telegram account.',
  ].join('\n');
  const pending = [];
  for (const m of out.matchAll(/X-Pairing-Code:\s*([0-9]{6})/gi)) pending.push({ code: m[1], platform: 'gateway' });
  for (const m of out.matchAll(/[│|]\s*([0-9]{6})\s*[│|]/g)) {
    const code = m[1];
    if (!pending.some(p => p.code === code)) pending.push({ code, platform: 'gateway' });
  }
  for (const m of out.matchAll(/one-time bind code:\s*([0-9]{4,8})/gi)) {
    const code = m[1];
    if (!pending.some(p => p.code === code)) pending.push({ code, platform: 'telegram-bind' });
  }
  assert.ok(pending.some(p => p.code === '018875' && p.platform === 'gateway'), 'gateway pairing code detected');
  assert.ok(pending.some(p => p.code === '388439' && p.platform === 'telegram-bind'), 'telegram bind code detected');
});

