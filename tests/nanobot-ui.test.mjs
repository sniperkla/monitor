import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/agents/nanobot/route.js', 'utf8');
const app = readFileSync('src/apps/AIAgentsApp.js', 'utf8');

function section(start, end) {
  const from = route.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? route.indexOf(end, from) : route.length;
  return route.slice(from, to < 0 ? route.length : to);
}

test('nanobot gateway status uses one layered, instance-aware probe', () => {
  const probe = section('const gwProbe =', 'const STATUS_SCRIPT');
  assert.match(probe, /PIDF/);
  assert.match(probe, /\/proc\/\$P\/cmdline/);
  assert.match(probe, /systemctl --user is-active/);
  assert.match(probe, /pgrep -f '\[n\]anobot'/);
  assert.match(probe, /PROC_ACTIVE/);
  assert.match(probe, /GWPID=/);

  const gateway = section("if (action === 'gateway')", "if (action === 'logs')");
  assert.match(gateway, /gwCtl\(op\)/);
  assert.doesNotMatch(gateway, /kill -0 \$\(cat/);

  const details = section("if (action === 'details')", "if (action === 'set-model-preset')");
  const health = section("if (action === 'health')", "if (action === 'skills')");
  assert.match(details, /\$\{gwProbe\(HH, PIDF, inst\)\}/);
  assert.match(health, /\$\{gwProbe\(HH, PIDF, inst\)\}/);
  assert.match(route, /const GW_FLAGS = ` --config "\$\{HH\}\/config\.json" --workspace/);
});

test('nanobot install resolves the real gateway PID after setsid', () => {
  const install = section("if (action === 'install')", "if (action === 'reconfigure')");
  assert.match(install, /setsid nohup/);
  assert.match(install, /REAL=\$\(NBSTARTSCAN=1;/);
  assert.match(install, /echo "\$REAL" > "\$\{PIDF\}"/);
  assert.match(install, /const up = await execCommand\(sshConfig, gwProbe\(HH, PIDF, inst\)/);
  assert.doesNotMatch(install, /if \(\[ -f "\$\{PIDF\}" \].*kill -0/);
});

test('nanobot skill enumeration includes recursive and bundled skills', () => {
  const details = section("if (action === 'details')", "if (action === 'set-model-preset')");
  assert.match(details, /import nanobot/);
  assert.match(details, /find \"\$NBSK\" -maxdepth 1/);
  assert.match(details, /find \"\$base\" -maxdepth 3 -name 'SKILL\.md'/);
  assert.match(details, /echo \"===SKILLS_BUNDLED===\"/);
  assert.match(details, /bundledSkills: \[\.\.\.bundledList\]/);
  // Tagged instances must not accidentally inherit the default home's skills.
  assert.match(details, /\$\{inst \? '' : ' \"\$HOME\/\.nanobot\/workspace\/skills\"/);
});

test('skill preview displays bundled skills and never offers dead removal controls', () => {
  const preview = app.slice(app.indexOf('const installedList = details.skills || [];'));
  assert.match(preview, /const bundledSet = new Set/);
  assert.match(preview, /installedList\.forEach\(x => selSkills\.has\(x\) \|\| bundledSet\.has\(x\)/);
  assert.match(preview, /const isBuiltIn = bundledSet\.has\(s\)/);
  assert.match(preview, /disabled=\{isBuiltIn\}/);
  assert.match(preview, /\{!isBuiltIn && \(/);
});
