import { NextResponse } from 'next/server';

/**
 * Shared in-memory job store for live agent action logs.
 *
 * When a client starts a long-running action (install / uninstall) with
 * `live: true`, the route returns a jobId immediately and keeps executing in
 * the background. The client polls `action: 'job'` with `{ jobId, cursor }`
 * to receive incremental log lines plus the final JSON result — giving a
 * real-time log view without websockets or SSE plumbing.
 *
 * Jobs are per-process and expire after 30 minutes (dev/prod single-node).
 */

const TTL_MS = 30 * 60 * 1000;
const MAX_LINES = 4000;

function store() {
  // Defensive: stash the Map on globalThis (not just global) so it survives
  // Next dev HMR re-evaluations of this module. globalThis is the spec'd
  // cross-realm global; the polyfilled `global` is webpack-specific.
  if (typeof globalThis.__agentActionJobs === 'undefined') {
    Object.defineProperty(globalThis, '__agentActionJobs', {
      value: new Map(), writable: false, configurable: true,
    });
  }
  const m = globalThis.__agentActionJobs;
  // opportunistic cleanup
  if (m.size > 50) {
    const now = Date.now();
    for (const [k, v] of m) {
      if (v.done && now - v.updatedAt > TTL_MS) m.delete(k);
    }
  }
  return m;
}

export function createJob() {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  store().set(id, { id, log: [], done: false, result: null, createdAt: Date.now(), updatedAt: Date.now() });
  return id;
}

export function jobAppend(jobId, line) {
  const job = store().get(jobId);
  if (!job || job.log.length >= MAX_LINES) return;
  job.log.push(String(line).slice(0, 3000));
  job.updatedAt = Date.now();
}

export function finishJob(jobId, result) {
  const job = store().get(jobId);
  if (!job) return;
  job.result = result || { success: false, error: 'no result' };
  job.done = true;
  job.updatedAt = Date.now();
}

export function getJobUpdate(jobId, cursor = 0) {
  const job = store().get(jobId);
  if (!job) return { success: false, error: 'Unknown or expired job' };
  const from = Math.max(0, Number(cursor) || 0);
  return {
    success: true,
    done: job.done,
    lines: job.log.slice(from),
    cursor: job.log.length,
    total: job.log.length,
    result: job.done ? job.result : null,
  };
}

/**
 * True when the request asks for live streaming of an action.
 */
export const isLiveAction = (body) =>
  !!body?.live && !['status', 'details', 'health', 'backups', 'logs', 'job'].includes(body?.action);

/**
 * Dispatch helper used by every agent route:
 *  - live install/uninstall → start background job, return jobId at once
 *  - `action: 'job'` → poll incremental log + final result
 *  - otherwise → run the handler inline (classic behaviour)
 *
 * `handler(body, log)` must return a NextResponse and use the passed `log`
 * array for all `$ label` step output.
 */
export async function dispatchWithLiveLogs(body, handler) {
  const { action } = body;

  // Poll an existing job — client sends { jobId, cursor } flat
  if (action === 'job') {
    const upd = getJobUpdate(body.jobId, body.cursor ?? 0);
    return NextResponse.json(upd);
  }

  if (isLiveAction(body)) {
    const jobId = createJob();
    const log = store().get(jobId).log;
    // Background execution — the client polls for progress.
    (async () => {
      try {
        const res = await handler(body, log);
        let payload = null;
        try { payload = await res.json(); } catch { /* non-JSON */ }
        finishJob(jobId, payload);
      } catch (e) {
        finishJob(jobId, { success: false, error: e?.message || String(e) });
      }
    })();
    return NextResponse.json({ success: true, jobId, live: true });
  }

  return handler(body, []);
}
