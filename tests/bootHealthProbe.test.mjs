import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyHealth } from '../src/utils/healthProbe.js';

// The real payloads. Production served both of these within the same hour on
// 2026-09-13. The second one is the one that halted the boot at 80%.
const HEALTHY  = { status: 'ok',       mongo: { up: true  }, relay: { up: true  } };
const DEGRADED = { status: 'degraded', mongo: { up: true  }, relay: { up: false } };
const DB_DOWN  = { status: 'degraded', mongo: { up: false }, relay: { up: false } };

const res = (status) => ({ ok: status >= 200 && status < 300, status });

test('a healthy 200 is usable and not flagged degraded', () => {
  const v = classifyHealth(res(200), HEALTHY);
  assert.equal(v.ok, true);
  assert.equal(v.degraded, false);
  assert.equal(v.dbDown, false);
});

test('a degraded 503 with the database UP is usable, not a database outage', () => {
  // The regression. The old check was
  //   dbDown = body.status === 'degraded' || res.status === 503
  // which is true for this payload, so the boot halted at 80% and told the user
  // the database was unreachable while mongo.up was reporting true.
  const v = classifyHealth(res(503), DEGRADED);
  assert.equal(v.ok, true, 'the boot must be allowed to continue');
  assert.equal(v.dbDown, false, 'the database is up — this must not be fatal');
  assert.equal(v.degraded, true, 'but it must still be surfaced as degraded');
});

test('a degraded 503 with the database DOWN is fatal', () => {
  const v = classifyHealth(res(503), DB_DOWN);
  assert.equal(v.ok, false);
  assert.equal(v.dbDown, true);
});

test('a 500 from the route is not reported as a database outage', () => {
  const v = classifyHealth(res(500), { status: 'error' });
  assert.equal(v.ok, false);
  assert.equal(v.dbDown, false);
});

test('a gateway error page (no mongo flag) is not a database outage', () => {
  const v = classifyHealth(res(502), {});
  assert.equal(v.ok, false);
  assert.equal(v.dbDown, false);
});

test('a 2xx with an unparseable body stays usable — no new failure mode', () => {
  const v = classifyHealth(res(200), {});
  assert.equal(v.ok, true);
});

test('a 503 with no body at all is still a database outage', () => {
  const v = classifyHealth(res(503), {});
  assert.equal(v.dbDown, true);
});

// ── Anti-drift ────────────────────────────────────────────────────────────────
// classifyHealth is only worth having if the boot screen actually calls it. A
// component that quietly reverted to the status-code-only check would pass every
// assertion above, so pin the wiring at the source.
const boot = readFileSync(new URL('../src/components/landing/BootSequence.js', import.meta.url), 'utf8');

test('BootSequence classifies through classifyHealth, not the status code', () => {
  assert.match(boot, /import \{ classifyHealth \} from '@\/utils\/healthProbe'/);
  assert.doesNotMatch(boot, /body\.status === 'degraded' \|\| res\.status === 503/);
});

test('both boot probes use the shared classifier', () => {
  const calls = boot.match(/classifyHealth\(/g) || [];
  assert.equal(calls.length, 2, 'the main probe and the 30s safeguard probe must both classify');
});
