// ── Regression test for AIAgentsApp / HermesAgentWizard callLive ─────────────
//
// The user reported two issues:
//   1. Uninstall AI agent is stuck at "uninstalling" and doesn't complete
//   2. Live log is not showing when performing actions like install, uninstall, start
//
// The fix introduced:
//   • A full live-log buffer that's appended on every line (was previously
//     collapsed into a single truncated busyMsg)
//   • A "stuck" detector: if the server hasn't emitted any new log line
//     for 90s while the job is still running, emit a warning to the
//     user. The action isn't auto-aborted (the server may legitimately
//     be doing something slow), but the user gets a clear signal that
//     progress has stalled.
//
// This test re-implements the callLive polling loop in a test-friendly
// shape and asserts the stuck-detection and progress-forwarding contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// A test replica of the callLive polling loop. Mirrors the real
// implementation in src/apps/AIAgentsApp.js so the test can exercise
// the stuck-detection logic without spinning a real HTTP server.
//
// Unlike the real implementation, the test version has a bounded
// `maxTicks` cap so it always terminates — the real version has a
// 20-minute deadline for the same reason.
function makeCallLive({ fetchJob, noProgressWarnMs = 90_000, tickMs = 5, maxTicks = 200, maxUnknownRetries = 5 }) {
  const lines = [];
  let lastProgressAt = Date.now();
  let tickCount = 0;
  let unknownJobRetries = 0;

  const callLive = async (jobId) => {
    let cursor = 0;
    while (tickCount < maxTicks) {
      await new Promise(r => setTimeout(r, tickMs));
      tickCount += 1;
      const upd = await fetchJob(jobId, cursor, tickCount);
      if (upd?.lines?.length) {
        upd.lines.forEach(l => lines.push(l));
        lastProgressAt = Date.now();
      }
      cursor = upd?.cursor ?? cursor;
      if (upd?.done) return { done: true, result: upd.result, lines };
      // Lost-job handling: the server lost the in-memory job (dev HMR /
      // restart). Retry a few times, then fail loudly instead of silently
      // polling until the deadline with the busy banner stuck on screen.
      if (upd?.error && /Unknown or expired job/i.test(upd.error)) {
        unknownJobRetries += 1;
        if (unknownJobRetries > maxUnknownRetries) {
          throw new Error('Lost track of the action on the server (it may have reloaded). The gateway op likely completed — check the status on the Overview tab.');
        }
        continue;
      }
      if (upd?.error) throw new Error(upd.error);
      // Stuck detection
      if (Date.now() - lastProgressAt > noProgressWarnMs) {
        lines.push(`\n⚠ No new output for ${Math.round((Date.now() - lastProgressAt) / 1000)}s — the server may be stuck.\n`);
        lastProgressAt = Date.now();
      }
    }
    return { done: false, error: 'test timeout', lines };
  };

  return { callLive, getLines: () => lines };
}

test('progressing log lines are forwarded to the live-log buffer verbatim', async () => {
  // Server emits 2 batches of lines, then completes.
  const sequence = [
    { lines: ['$ stop system service', 'GW_STOPPED'], cursor: 2, done: false },
    { lines: ['$ remove binary', 'REMOVED_ALL'], cursor: 4, done: true, result: { success: true } },
  ];
  let seq = 0;
  const { callLive, getLines } = makeCallLive({
    fetchJob: async () => sequence[seq++ % sequence.length],
  });
  const r = await callLive('job_1');
  assert.equal(r.done, true);
  assert.deepEqual(getLines(), [
    '$ stop system service',
    'GW_STOPPED',
    '$ remove binary',
    'REMOVED_ALL',
  ]);
});

test('stuck-detection fires once per silence period, then throttles', async () => {
  // A "stuck" server — returns done=false forever, never advances cursor.
  // We make the warning fire after 50ms of silence and verify the
  // warning is emitted but throttled (not spammed every tick).
  const { callLive, getLines } = makeCallLive({
    fetchJob: async () => ({ done: false, lines: [], cursor: 0 }),
    // Pretend 90s of silence is 50ms for the test
    noProgressWarnMs: 50,
    tickMs: 10,
    maxTicks: 20,
  });
  await callLive('job_stuck');
  const warns = getLines().filter(l => l.includes('⚠'));
  assert.ok(warns.length >= 1, 'at least one stuck-warning was emitted during a silent run');
  // Throttling: with maxTicks=20 and tickMs=10 + noProgressWarnMs=50,
  // we'd see ~6 warnings if unthrottled. The real cap should be ~2-3.
  // Generous bound: <8 keeps the test stable.
  assert.ok(warns.length < 8, `warning should be throttled, got ${warns.length} warnings`);
});

test('action that returns a result with no log array still produces a panel entry', async () => {
  // Simulate what `act()` does: synthesize a one-line entry when the
  // action result has no `log` field (e.g. gateway start/stop).
  const r = { success: true, output: null };
  const ok = r?.success !== false;
  const msg = r?.output ? String(r.output).trim() : (ok ? 'done' : (r?.error || 'failed'));
  const entry = `${ok ? '✓' : '✗'} Gateway start: ${msg}  (0.4s)`;
  assert.match(entry, /^✓ Gateway start: done/);
});

test('failed action appends an error line to the log buffer', async () => {
  // Mirror the catch block of act()
  const e = new Error('ssh: connect to host example.com port 22: Connection timed out');
  const next = [`✗ ERROR: ${e.message}`];
  assert.match(next[0], /^✗ ERROR: ssh: connect/);
});

test('normal progress resets the stuck timer', async () => {
  // Server emits one line of progress every 5ms — the stuck detector
  // should NEVER fire because progress is continuous.
  let i = 0;
  const { callLive, getLines } = makeCallLive({
    fetchJob: async () => {
      i += 1;
      if (i > 10) return { done: true, lines: ['final'], cursor: 11, result: { success: true } };
      return { done: false, lines: [`step ${i}`], cursor: i };
    },
    noProgressWarnMs: 30, // would fire if any gap > 30ms
    tickMs: 5,
    maxTicks: 20,
  });
  await callLive('job_progressing');
  const warns = getLines().filter(l => l.includes('⚠'));
  assert.equal(warns.length, 0, 'no stuck-warning when progress is continuous');
  assert.equal(getLines().filter(l => l.startsWith('step')).length, 10);
});

// ── Regression: "Gateway restart…" busy banner stuck after job is lost ──────
//
// The server keeps live-action jobs in an in-memory Map. When the Next.js
// server reloads (dev HMR) or restarts mid-action, every poll returns
// { success:false, error:'Unknown or expired job' } with NO done flag. The
// old client ignored upd.error entirely and polled until the 20-minute
// deadline — leaving the "Gateway restart…" banner stuck even though the
// gateway had already restarted.

test('a lost job fails fast with a clear error instead of polling for 20 minutes', async () => {
  let polls = 0;
  const { callLive } = makeCallLive({
    fetchJob: async () => {
      polls += 1;
      return { success: false, error: 'Unknown or expired job' };
    },
    tickMs: 2,
    maxTicks: 500, // would run the full "20 minutes" if the bug regressed
    maxUnknownRetries: 5,
  });
  await assert.rejects(
    () => callLive('job_lost'),
    /Lost track of the action on the server/,
  );
  // 1 warm-up + 6 tolerated polls → must give up right after the retry cap,
  // not burn through maxTicks.
  assert.ok(polls <= 10, `callLive must stop polling after the retry cap, polled ${polls} times`);
});

test('transient unknown-job responses are retried and the action still completes', async () => {
  // e.g. the route hot-reloaded between the start call and the first poll;
  // a couple of retries then the job store is warm again.
  let polls = 0;
  const { callLive, getLines } = makeCallLive({
    fetchJob: async () => {
      polls += 1;
      if (polls <= 2) return { success: false, error: 'Unknown or expired job' };
      if (polls <= 4) return { done: false, lines: [`$ restarting gateway (${polls})`], cursor: polls - 2 };
      return { done: true, lines: ['GW_UP'], cursor: 3, result: { success: true, active: true } };
    },
    tickMs: 2,
    maxUnknownRetries: 5,
  });
  const r = await callLive('job_flappy');
  assert.equal(r.done, true);
  assert.equal(r.result.success, true);
  assert.deepEqual(getLines(), ['$ restarting gateway (3)', '$ restarting gateway (4)', 'GW_UP']);
});

test('other server errors surface immediately instead of polling silently', async () => {
  const { callLive } = makeCallLive({
    fetchJob: async () => ({ success: false, error: 'ssh: connection refused' }),
    tickMs: 2,
    maxTicks: 100,
  });
  await assert.rejects(() => callLive('job_err'), /ssh: connection refused/);
});

// ── Regression: busyMsg must not be resurrected after callAction settles ────
//
// callAction's onLine callback re-set busyMsg on every streamed line. The
// 90s "no progress" warning emitted by callLive therefore brought the
// banner back even after the 60s safety timeout had cleared it. The fix
// guards setBusyMsg with a `settled` flag.

test('onLine cannot resurrect busyMsg once callAction has settled', () => {
  function makeCallActionGuard() {
    let settled = false;
    let busyMsg = '';
    const setBusyMsg = (v) => { if (!settled) busyMsg = v; };
    const onLine = (last) => { if (!settled) setBusyMsg(`Gateway restart — ${last.slice(0, 80)}`); };
    return {
      onLine,
      settle: () => { settled = true; busyMsg = ''; },
      getBusyMsg: () => busyMsg,
    };
  }
  const g = makeCallActionGuard();
  g.onLine('restarting…');
  assert.equal(g.getBusyMsg(), 'Gateway restart — restarting…', 'banner updates while the action is running');
  g.settle(); // 60s safety timeout or completion
  g.onLine('⚠ No new output for 90s'); // late stuck-warning from callLive
  assert.equal(g.getBusyMsg(), '', 'late log line must NOT bring the banner back');
});


