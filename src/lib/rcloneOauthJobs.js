import { NextResponse } from 'next/server';

/**
 * Server-side TTL store for completed OAuth exchanges.
 *
 * Why this exists: the popup's token used to travel ONLY via postMessage to
 * the opener window. If the opener reloaded while the user was on Google
 * (very common on mobile — switching tabs evicts the tab), the postMessage
 * listener was gone and the token was silently lost: "nothing happened, the
 * config never saved". Now the callback stores the token here keyed by a
 * one-time jobId; the opener (or a reloaded RcloneApp tab reading the
 * localStorage flag) can complete the save later via save-token { jobId }.
 *
 * In-memory on purpose: short-lived (10 min TTL), single-use, and never
 * persisted to disk or DB.
 *
 * Lives in lib/ (not in the route file) because Next.js restricts the
 * exports a route module may contain.
 */
const TTL_MS = 10 * 60 * 1000;

export function putOauthJob(payload) {
  if (!globalThis.__rcloneOauthJobs) globalThis.__rcloneOauthJobs = new Map();
  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  // Prune expired entries so the map cannot grow unbounded
  const now = Date.now();
  for (const [k, v] of globalThis.__rcloneOauthJobs) {
    if (now - v.ts > TTL_MS) globalThis.__rcloneOauthJobs.delete(k);
  }
  globalThis.__rcloneOauthJobs.set(jobId, { ...payload, ts: now });
  return jobId;
}

export function takeOauthJob(jobId) {
  if (!jobId || !globalThis.__rcloneOauthJobs) return null;
  const job = globalThis.__rcloneOauthJobs.get(jobId);
  globalThis.__rcloneOauthJobs.delete(jobId); // single-use
  if (!job) return null;
  if (Date.now() - job.ts > TTL_MS) return null;
  return job;
}
