import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * A shell-quoting bug in zeroclaw's gateway stop, and the design rule that
 * makes its return value trustworthy again.
 *
 * `gwCtl('stop')` builds one long shell line and decides success by grepping
 * its own stdout for the marker `GW_STOPPED`. The default-install branch
 * interpolates a `broadKill` fragment immediately before that `echo`:
 *
 *     ... ${broadKill} echo GW_STOPPED
 *
 * When the fragment did not end in `;`, the shell read the tail as a single
 * simple command — `true echo GW_STOPPED` — and `true` ignores its arguments.
 * Nothing was printed, `/GW_STOPPED/` never matched, and the caller reported
 * `success: false` for a stop that had actually worked. The Overview tab's
 * "Stop gateway" was broken this way, silently, for every default install.
 *
 * Two things are pinned here: the shell semantics that make the trailing `;`
 * load-bearing, and the rule that the newer `webui-ctl stop` must decide by
 * probing the port rather than by re-reading that marker.
 */

const sh = (cmd) => execFileSync('sh', ['-c', cmd], { encoding: 'utf8' }).trim();

test('a command after `true` is swallowed; after `true;` it runs', () => {
  // This is the whole bug in two lines of shell. If this ever stops being
  // true, the trailing semicolon below stops being load-bearing and this file
  // should be simplified — but as long as it holds, the `;` is required.
  assert.equal(sh('true echo GW_STOPPED'), '', '`true echo X` must print nothing (the bug)');
  assert.equal(sh('true; echo GW_STOPPED'), 'GW_STOPPED', '`true; echo X` must print the marker (the fix)');
});

const zeroclaw = readFileSync('src/app/api/agents/zeroclaw/route.js', 'utf8');

test('zeroclaw broadKill ends in `;` so the GW_STOPPED marker survives', () => {
  const m = /const broadKill = inst \? '' : `([^`]*)`;/.exec(zeroclaw);
  assert.ok(m, 'broadKill must be a template literal assigned to a const');
  const fragment = m[1];
  assert.ok(fragment.length > 0, 'broadKill must not be empty for the default install');
  assert.ok(fragment.endsWith(';'),
    `broadKill must end with ';' — it is interpolated directly before 'echo GW_STOPPED'. Got tail: ${JSON.stringify(fragment.slice(-20))}`);

  // And prove the interpolation site is still the fragile shape this guards.
  assert.match(zeroclaw, /\$\{broadKill\} echo GW_STOPPED/,
    'broadKill must still be interpolated immediately before the marker echo');
});

test('the default-install stop still reports success off the marker', () => {
  // If this ever changes to a probe, the semicolon stops mattering — but until
  // then, removing it silently breaks Stop on every default install.
  const stopBranch = zeroclaw.slice(zeroclaw.indexOf("const broadKill"));
  assert.match(stopBranch, /echo GW_STOPPED/, 'the marker must still be emitted');
  assert.match(stopBranch, /\/GW_STOPPED\/\.test/, 'success must still be decided by the marker');
});

test('webui-ctl stop decides by probing the port, not by the marker', () => {
  // The marker is a string that a quoting slip can swallow — which is exactly
  // what happened. "Is the dashboard still answering?" cannot be faked by a
  // shell mistake, so the Web UI control path asks that instead.
  for (const [name, file] of [
    ['zeroclaw', 'src/app/api/agents/zeroclaw/route.js'],
    ['openclaw', 'src/app/api/agents/openclaw/route.js'],
  ]) {
    const src = readFileSync(file, 'utf8');
    const block = src.slice(src.indexOf("if (action === 'webui-ctl')"));
    assert.ok(block.length > 200, `${name}: webui-ctl block not found`);
    const stop = block.slice(block.indexOf("if (op === 'stop')"));
    const stopBranch = stop.slice(0, stop.indexOf("if (op === 'relay-start')"));
    assert.ok(stopBranch.length > 100, `${name}: stop branch not found`);
    // It must call the probe and act on `active`.
    assert.match(stopBranch, /probe\(\)/, `${name}: stop must probe the port`);
    assert.match(stopBranch, /stillUp/, `${name}: stop must act on the probe result`);
    // And it must NOT decide off the marker grep.
    assert.doesNotMatch(stopBranch, /\/GW_STOPPED\/\.test/,
      `${name}: stop must not decide by the GW_STOPPED marker`);
  }
});
