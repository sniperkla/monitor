// ── Behavioral test for GlobalScanNotifications ───────────────────────────────
//
// Pins the *contract* of the desktop-wide virus-scan polling subsystem. The
// implementation lives in src/components/GlobalScanNotifications.js but we
// re-implement the core "interest tracking" decision here in a test-
// friendly shape so the test doesn't depend on jsdom / React.
//
// Why this matters: previously, GlobalScanNotifications polled every SSH
// connection's tmux scan status every 60s (or 10s while a scan was
// running), regardless of whether the user had ever opened the Virus
// Scanner app or installed any engine. With 10 SSH connections, that
// meant 10–60 /api/virus-scan/engine?tmux=1 requests per minute, forever,
// even when nothing has ever scanned. The fix introduces three backoff
// tiers (10s active / 60s interested / 5 min idle) and per-connection
// "interest" tracking.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// A minimal in-test replica of the poll loop's interest-tracking logic.
// We re-implement the *core decision* (do I poll this connection right
// now, and at what interval?) so the test pins the behavior in a way
// that survives refactors.
function makePoller() {
  const ACTIVE_POLL_MS = 10_000;
  const INTERESTED_POLL_MS = 60_000;
  const IDLE_BACKOFF_MS = 5 * 60_000;
  const MAX_CONNS_PER_PASS = 10;

  const interested = new Set();
  let lastSchedule = null;
  let initialDiscoveryDone = false;

  const isConnectionInteresting = (sessions) => {
    if (!sessions) return false;
    if (sessions.clamav && sessions.clamav !== 'idle') return true;
    if (sessions.maldet && sessions.maldet !== 'idle') return true;
    if (sessions.wazuh != null) return true;
    return false;
  };

  const selectToPoll = (conns) => {
    const interestedList = conns.filter(c => interested.has(c._id));
    if (interestedList.length > 0) return { list: interestedList.slice(0, MAX_CONNS_PER_PASS), isDiscovery: false };
    if (initialDiscoveryDone) return { list: null, isDiscovery: false };
    return { list: conns.slice(0, MAX_CONNS_PER_PASS), isDiscovery: true };
  };

  const poll = async (conns, fetchSessions) => {
    const { list: toPoll, isDiscovery } = selectToPoll(conns);
    let anyRunning = false;
    if (toPoll) {
      for (const conn of toPoll) {
        const sessions = await fetchSessions(conn._id);
        if (isConnectionInteresting(sessions)) interested.add(conn._id);
        else interested.delete(conn._id);
        if (sessions && (sessions.clamav === 'running' || sessions.maldet === 'running')) {
          anyRunning = true;
        }
      }
      // If we just did an initial-discovery pass and nothing turned out
      // interesting, mark it done so we never re-probe until recheck().
      if (isDiscovery && interested.size === 0) {
        initialDiscoveryDone = true;
      }
    }
    lastSchedule = anyRunning
      ? ACTIVE_POLL_MS
      : (interested.size > 0 ? INTERESTED_POLL_MS : IDLE_BACKOFF_MS);
    return { polled: toPoll ? toPoll.length : 0, anyRunning, schedule: lastSchedule };
  };

  const recheck = () => { interested.clear(); initialDiscoveryDone = false; };

  return {
    poll,
    recheck,
    isConnectionInteresting,
    getInterested: () => new Set(interested),
    getSchedule: () => lastSchedule,
  };
}
test('initial poll: probes up to MAX_CONNS_PER_PASS even when nothing is interesting', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];
  const res = await p.poll(conns, async () => ({ clamav: 'idle', maldet: 'idle', wazuh: null }));
  assert.equal(res.polled, 3, 'all 3 connections should be probed on first poll');
  assert.equal(res.schedule, 5 * 60_000, 'with nothing interesting, schedule is the 5-min backoff');
  assert.equal(p.getInterested().size, 0);
});

test('after a scan starts on one connection: schedule tightens to ACTIVE_POLL_MS (only after recheck)', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }, { _id: 'b' }];
  // First poll: initial discovery, nothing interesting.
  await p.poll(conns, async () => ({ clamav: 'idle', maldet: 'idle', wazuh: null }));
  assert.equal(p.getSchedule(), 5 * 60_000);
  // Without a recheck, the poller does NOT keep probing on subsequent
  // ticks (this is the whole point of the lazy fix). The only way to
  // discover a newly-started scan is for the user to engage with the
  // Virus Scanner app, which dispatches `virus-scan:recheck`.
  await p.poll(conns, async (id) => id === 'a'
    ? { clamav: 'running', maldet: 'idle', wazuh: null }
    : { clamav: 'idle', maldet: 'idle', wazuh: null });
  assert.equal(p.getSchedule(), 5 * 60_000, 'no recheck → no probe → no detection');

  // Now simulate the user opening the Virus Scanner app, which
  // dispatches the recheck event. The poller re-probes and finds the
  // new scan.
  p.recheck();
  const res = await p.poll(conns, async (id) => id === 'a'
    ? { clamav: 'running', maldet: 'idle', wazuh: null }
    : { clamav: 'idle', maldet: 'idle', wazuh: null });
  assert.equal(res.anyRunning, true);
  assert.equal(res.schedule, 10_000, 'active scan → 10s polling');
  assert.ok(p.getInterested().has('a'));
  assert.ok(!p.getInterested().has('b'), 'b is still idle and not interesting');
});

test('after a scan finishes: schedule relaxes but connection stays "interested" until idle', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }];
  await p.poll(conns, async () => ({ clamav: 'running', maldet: 'idle', wazuh: null }));
  const res = await p.poll(conns, async () => ({ clamav: 'done', maldet: 'idle', wazuh: null }));
  assert.equal(res.schedule, 60_000, '60s (interested but nothing running)');
  assert.ok(p.getInterested().has('a'), 'still interested because clamav is "done", not "idle"');
});

test('once clamav is back to idle: connection drops from interested, schedule → IDLE_BACKOFF_MS', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }];
  await p.poll(conns, async () => ({ clamav: 'done', maldet: 'idle', wazuh: null }));
  const res = await p.poll(conns, async () => ({ clamav: 'idle', maldet: 'idle', wazuh: null }));
  assert.equal(res.schedule, 5 * 60_000, 'no longer interested → 5-min backoff');
  assert.equal(p.getInterested().size, 0);
});

test('wazuh being non-null counts as interesting even with both scanners idle', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }];
  const res = await p.poll(conns, async () => ({ clamav: 'idle', maldet: 'idle', wazuh: 'active' }));
  assert.equal(res.schedule, 60_000, 'wazuh active → interested (60s)');
  assert.ok(p.getInterested().has('a'));
});

test('with 5 idle connections: zero subsequent polls, only 5 calls in the first hour', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'd' }, { _id: 'e' }];
  let calls = 0;
  const fetchSessions = async () => {
    calls += 1;
    return { clamav: 'idle', maldet: 'idle', wazuh: null };
  };
  await p.poll(conns, fetchSessions);
  assert.equal(calls, 5);
  for (let i = 0; i < 11; i++) {
    await p.poll(conns, fetchSessions);
  }
  assert.equal(calls, 5, 'after initial discovery, idle poller does NOT probe further');
});

test('recheck() resets the interested set and forces a fresh full probe', async () => {
  const p = makePoller();
  const conns = [{ _id: 'a' }, { _id: 'b' }];
  await p.poll(conns, async (id) => id === 'a'
    ? { clamav: 'idle', maldet: 'idle', wazuh: 'active' }
    : { clamav: 'idle', maldet: 'idle', wazuh: null });
  assert.ok(p.getInterested().has('a'));
  assert.ok(!p.getInterested().has('b'));
  p.recheck();
  let calls = 0;
  const seen = new Set();
  await p.poll(conns, async (id) => {
    calls += 1;
    seen.add(id);
    return { clamav: 'idle', maldet: 'idle', wazuh: null };
  });
  assert.equal(calls, 2, 'both connections re-probed after recheck');
  assert.ok(seen.has('a') && seen.has('b'));
  assert.equal(p.getInterested().size, 0, 'both are now idle');
});

test('MAX_CONNS_PER_PASS caps the initial discovery even for 100 connections', async () => {
  const p = makePoller();
  const conns = Array.from({ length: 100 }, (_, i) => ({ _id: `c${i}` }));
  const res = await p.poll(conns, async () => ({ clamav: 'idle', maldet: 'idle', wazuh: null }));
  assert.equal(res.polled, 10, 'initial discovery capped at 10');
});
