import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRestoreServiceExec, buildAllowlistRestoreFragment } from '@/lib/firewallBlocklist';

function shCheck(name, script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fw-seam-'));
  const file = path.join(dir, 'exec.sh');
  writeFileSync(file, '#!/bin/sh\n' + script + '\n');
  for (const [bin, args] of [['sh', ['-n']], ['/bin/bash', ['--posix', '-n']]]) {
    try {
      execFileSync(bin, [...args, file], { stdio: 'ignore' });
    } catch {
      assert.fail(`${name}: ${bin} -n rejected the assembled ExecStart`);
    }
  }
}

test('allowlist restore fragment joins the blocklist exec with a separator (no "fi if" mistake)', () => {
  const exec = buildRestoreServiceExec(buildAllowlistRestoreFragment());
  // The seam between the DOCKER-USER cleanup and the allowlist restore must
  // have `; ` after `fi` — a bare space produces `fi if [...]`, which is a
  // POSIX syntax error and makes monitor-blocklist-restore.service fail to
  // start (blocklist + allowlist never re-applied after reboot).
  // The seam: find the FIRST occurrence of the allowlist guard — that's where
  // the blocklist DOCKER-USER cleanup ends and the allowlist fragment begins.
  const idx = exec.indexOf('if [ -f /var/lib/monitor-firewall/monitor_allowlist.ipset');
  const tail = exec.slice(Math.max(0, idx - 80), idx + 100);
  assert.match(tail, /; fi;\s+if \[ -f \/var\/lib\/monitor-firewall\/monitor_allowlist\.ipset \]/,
    `seam must be '; fi; if [...]', got: ...${tail}`);
  assert.doesNotMatch(tail, /fi if \[ -f \/var\/lib\/monitor-firewall\/monitor_allowlist\.ipset \]/);
  // And the whole thing must parse under real shells.
  shCheck('allowlist fragment', exec);
});

test('restore ExecStart with allowlist restores ipset + ACCEPT rules across INPUT/FORWARD/DOCKER-USER', () => {
  const exec = buildRestoreServiceExec(buildAllowlistRestoreFragment());
  assert.match(exec, /ipset create monitor_blocklist hash:net family inet/);
  assert.match(exec, /ipset create monitor_manual_blocks hash:net family inet/);
  assert.match(exec, /ipset create monitor_all list:set -exist/);
  assert.match(exec, /ipset restore -exist < \/var\/lib\/monitor-firewall\/monitor_blocklist\.ipset/);
  assert.match(exec, /ipset restore -exist < \/var\/lib\/monitor-firewall\/monitor_allowlist\.ipset/);
  assert.match(exec, /INPUT -m set --match-set monitor_allowlist src -j ACCEPT/);
  assert.match(exec, /FORWARD -m set --match-set monitor_allowlist src -j ACCEPT/);
  assert.match(exec, /DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT/);
  // ACCEPT rules go above the DROP rules (I = insert at position 1).
  assert.match(exec, /iptables -I INPUT 1 -m set --match-set monitor_allowlist src -j ACCEPT/);
  shCheck('full restore', exec);
});

test('restore ExecStart without allowlist is still valid and has no orphan "fi if"', () => {
  const exec = buildRestoreServiceExec('');
  assert.doesNotMatch(exec, /fi\s+if /);
  shCheck('no-allowlist restore', exec);
});