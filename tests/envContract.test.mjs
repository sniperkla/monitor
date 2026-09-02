// ── Contract test: docker-compose.yml and .env.example must agree ──
//
// On 2026-09-02 a deploy took production down. The mongo service declares
// MONGO_INITDB_ROOT_USERNAME literally but MONGO_INITDB_ROOT_PASSWORD as
// ${MONGO_PASSWORD}; MONGO_PASSWORD was absent from the deployed .env, compose
// interpolated it to "", and mongo refused to start because only one of the
// pair was set:
//
//   error: missing 'MONGO_INITDB_ROOT_USERNAME' or 'MONGO_INITDB_ROOT_PASSWORD'
//          both must be specified for a user to be created
//
// No build step, test or lint rule could see it: the missing value lives in a
// .env that is deliberately not in git. Two controls exist for that:
//
//   1. scripts/preflight.sh — runs on the host before `docker compose up`,
//      where the real .env is visible. This is the one that actually prevents
//      the outage.
//   2. This test — keeps the two TRACKED files in sync, so adding a new ${VAR}
//      to compose cannot quietly outrun the documented template.
//
// It cannot check the deployed .env, and nothing should pretend otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

/** Every ${VAR} (or ${VAR:-default}) that compose interpolates. */
function composeRefs() {
  return new Set(
    [...compose.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
  );
}

/** Variables the template assigns. */
function exampleVars() {
  return new Set([...example.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]));
}

test('every variable compose interpolates is documented in .env.example', () => {
  const refs = composeRefs();
  const documented = exampleVars();
  assert.ok(refs.size > 0, 'no ${VAR} references found in docker-compose.yml');

  const undocumented = [...refs].filter((v) => !documented.has(v));
  assert.deepEqual(
    undocumented,
    [],
    `docker-compose.yml interpolates these but .env.example never assigns them, so ` +
      `a fresh deploy has no way to know they are required: ${undocumented.join(', ')}`
  );
});

test('MONGO_PASSWORD is interpolated by compose and present in the template', () => {
  // The specific pair that caused the outage. Pinning it here means removing
  // the interpolation or the template entry fails loudly instead of at boot.
  assert.match(compose, /MONGO_INITDB_ROOT_PASSWORD:\s*\$\{MONGO_PASSWORD\}/);
  assert.ok(exampleVars().has('MONGO_PASSWORD'), '.env.example must define MONGO_PASSWORD');
});

test('compose does not hardcode a credential', () => {
  // The reason the templating exists: this value used to be a literal in a
  // public repo. Guard the regression, not just the current state.
  const suspicious = [...compose.matchAll(/(PASSWORD|SECRET|TOKEN|KEY)\s*[:=]\s*(\S+)/g)]
    .filter((m) => {
      const v = m[2];
      return !v.startsWith('${') && !/^(true|false|null|""|'')$/i.test(v);
    })
    .map((m) => `${m[1]}=${m[2]}`);
  assert.deepEqual(suspicious, [], `compose contains literal credential values: ${suspicious.join(', ')}`);
});
