import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Extract buildSettingsMergePy from route
const routeSrc = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
const fnStart = routeSrc.indexOf('function dottedSettingKey');
const fnEnd = routeSrc.indexOf('\nconst PROVIDER_ENV_KEYS');
assert.ok(fnStart > -1 && fnEnd > fnStart, 'buildSettingsMergePy must exist');

const modPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'cfg-merge-')), 'fn.mjs');
writeFileSync(modPath, routeSrc.slice(fnStart, fnEnd));
const { buildSettingsMergePy } = await import(`file://${modPath}`);

const python = (() => {
  for (const bin of ['python3', 'python']) {
    try {
      execFileSync(bin, ['-c', 'print(1)'], { stdio: 'ignore' });
      return bin;
    } catch { /* next */ }
  }
  return null;
})();

function applyMerge(settings, initial = '') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-cfg-'));
  const cfgPath = path.join(dir, 'config.yaml');
  if (initial !== null) writeFileSync(cfgPath, initial);
  const script = buildSettingsMergePy(settings);
  const out = execFileSync(python, ['-c', script], {
    env: { ...process.env, HERMES_HOME: dir },
    encoding: 'utf8',
  });
  return { text: readFileSync(cfgPath, 'utf8'), out };
}

test('merging model into config.yaml keeps valid nested model structure', { skip: !python && 'python3 unavailable' }, () => {
  const initialYaml = [
    'model:',
    '  default: z-ai/glm-5.2',
    '  provider: zai',
    'gateway:',
    '  platforms:',
    '    telegram:',
    '      enabled: false',
  ].join('\n') + '\n';

  const { text, out } = applyMerge([
    ['model', 'openrouter/free'],
    ['model.provider', 'openrouter'],
    ['gateway.platforms.telegram.enabled', 'true'],
  ], initialYaml);

  assert.match(out, /SETTINGS_MERGED/);
  // Verify model was not written as a top-level scalar
  assert.doesNotMatch(text, /^model:\s+openrouter/m, 'model must not be a flat scalar clobbering the block');
  assert.match(text, /default:\s*openrouter\/free/m, 'default model must be openrouter/free');
  assert.match(text, /provider:\s*openrouter/m, 'model provider must be openrouter');
  assert.match(text, /enabled:\s*true/m, 'telegram enabled should be updated');
});

test('merging into fresh/empty config.yaml creates valid nested structure', { skip: !python && 'python3 unavailable' }, () => {
  const { text, out } = applyMerge([
    ['model.default', 'openrouter/free'],
    ['model.provider', 'openrouter'],
  ], '');

  assert.match(out, /SETTINGS_MERGED/);
  assert.match(text, /^model:/m);
  assert.match(text, /default:\s*openrouter\/free/m);
  assert.match(text, /provider:\s*openrouter/m);
});
