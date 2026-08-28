// ── Regression test: one-click install modal wipes typed-in values ──────────
//
// The user reported: "modal one-click install — when I swap tab the value is
// gone… it's every X sec it refreshes my input."
//
// Root causes (fixed):
//   1. AIAgentsApp created the `connections` prop with `.filter()` on every
//      render → a NEW array identity every time the app re-rendered (health/
//      heartbeat polling re-renders every few seconds).
//   2. HermesAgentWizard's reset effect depended on `[selectedId, connections,
//      agent.id]` → it re-ran on every one of those renders, wiping apiKey,
//      tok1, tok2, allowedIds, advEnv… while the user was typing.
//
// The fix:
//   • AIAgentsApp memoizes the filtered connections (stable identity while
//     `state.connections` is unchanged).
//   • The wizard's reset effect depends on a stable connection-ID signature
//     (`ids.join('|')`) instead of the array identity.
//
// These tests replicate both contracts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mini effect-runner: re-runs `effect` whenever any dep changes (Object.is).
function makeEffectRunner(effect) {
  let prevDeps = null;
  let runs = 0;
  return {
    render(deps) {
      const changed =
        !prevDeps ||
        deps.length !== prevDeps.length ||
        deps.some((d, i) => !Object.is(d, prevDeps[i]));
      if (changed) {
        runs += 1;
        effect();
      }
      prevDeps = deps;
      return runs;
    },
    get runs() { return runs; },
  };
}

const CONN_IDS = ['conn_a', 'conn_b'];

test('wizard reset effect ignores a re-created connections array with the same ids', () => {
  // Simulates the fixed wizard: deps use a stable id signature, and the
  // array itself is read through a ref.
  let connectionsRef = null;
  const reset = () => { connectionsRef && (globalThis.__wiped = (globalThis.__wiped || 0) + 1); };
  const runner = makeEffectRunner(reset);

  const list1 = [{ _id: 'conn_a' }, { _id: 'conn_b' }];
  connectionsRef = list1;
  const keyOf = (l) => l.map(c => c._id).join('|');

  runner.render([undefined, keyOf(list1), 'hermes']); // initial mount → 1 run
  assert.equal(runner.runs, 1);

  // Health poll re-renders the parent → brand-new array, SAME ids.
  const list2 = [{ _id: 'conn_a' }, { _id: 'conn_b' }];
  assert.notEqual(list1, list2, 'parent re-creates the array (precondition)');
  connectionsRef = list2;
  runner.render([undefined, keyOf(list2), 'hermes']);
  assert.equal(runner.runs, 1, 'same connection ids must NOT re-run the reset (inputs survive)');
});

test('wizard reset effect still fires when the connection set actually changes', () => {
  globalThis.__wiped = 0;
  let connectionsRef = null;
  const runner = makeEffectRunner(() => { globalThis.__wiped += 1; });
  const keyOf = (l) => l.map(c => c._id).join('|');

  const list1 = [{ _id: 'conn_a' }];
  connectionsRef = list1;
  runner.render([undefined, keyOf(list1), 'hermes']);

  const list2 = [{ _id: 'conn_a' }, { _id: 'conn_b' }]; // user added a server
  connectionsRef = list2;
  runner.render([undefined, keyOf(list2), 'hermes']);
  assert.equal(runner.runs, 2, 'a real change in connection ids re-runs the reset');
  assert.equal(globalThis.__wiped, 2);
});

test('wizard reset effect fires when the selected server or agent changes', () => {
  globalThis.__wiped = 0;
  const list = [{ _id: 'conn_a' }, { _id: 'conn_b' }];
  const keyOf = (l) => l.map(c => c._id).join('|');
  const runner = makeEffectRunner(() => { globalThis.__wiped += 1; });

  runner.render(['conn_a', keyOf(list), 'hermes']);
  runner.render(['conn_a', keyOf(list), 'hermes']); // unrelated re-render
  assert.equal(runner.runs, 1);

  runner.render(['conn_b', keyOf(list), 'hermes']); // user picked another server
  assert.equal(runner.runs, 2);

  runner.render(['conn_b', keyOf(list), 'zeroclaw']); // user switched agent
  assert.equal(runner.runs, 3);
});

test('memoized connections filter keeps identity stable and excludes databases', () => {
  // Mirrors the fixed AIAgentsApp: useMemo over state.connections.
  let memoCache = { deps: null, value: null };
  const memoizedFilter = (stateConnections) => {
    if (memoCache.deps === stateConnections) return memoCache.value;
    memoCache = { deps: stateConnections, value: (stateConnections || []).filter(c => c.type !== 'database') };
    return memoCache.value;
  };

  const stateConns = [
    { _id: 'a', type: 'ssh' },
    { _id: 'b', type: 'database' },
    { _id: 'c', type: undefined }, // legacy connections have no type
  ];

  const v1 = memoizedFilter(stateConns);
  const v2 = memoizedFilter(stateConns); // health poll re-render, same state slice
  assert.equal(v1, v2, 'same state.connections → same memoized array (no prop churn)');

  const sshOnly = memoizedFilter(stateConns).map(c => c._id);
  assert.deepEqual(sshOnly, ['a', 'c'], 'database connections are filtered out');

  const next = [...stateConns, { _id: 'd', type: 'ssh' }];
  const v3 = memoizedFilter(next);
  assert.notEqual(v3, v2, 'new state.connections → recomputed');
  assert.deepEqual(v3.map(c => c._id), ['a', 'c', 'd']);
});
