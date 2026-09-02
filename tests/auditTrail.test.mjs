// ── Regression test: the security audit trail is complete and unambiguous ───
//
// Two real defects motivated this file:
//
// 1. Privileged server-monitor actions (start/stop/uninstall a service on a
//    user's server) were written ONLY to the `auditlogs` collection via the
//    AuditLog model. The documented security trail is `audit_logs`, so the
//    highest-severity actions in the product were invisible to an incident
//    review that queried the documented collection.
//
// 2. Mongoose pluralizes without snake-casing, so `AuditLog` -> `auditlogs`
//    while src/lib/auditLog.js hardcodes `audit_logs`. Two distinct
//    collections whose names differ by an underscore. Nothing in the codebase
//    reads either one, so this cannot be caught by a runtime test — it has to
//    be asserted against the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const auditLib = readSrc('src/lib/auditLog.js');
const auditModel = readSrc('src/models/AuditLog.js');
const activityModel = readSrc('src/models/ActivityLog.js');
const appAction = readSrc('src/app/api/server-monitor/app-action/route.js');

test('security trail writes to the documented audit_logs collection', () => {
  assert.match(auditLib, /collection\('audit_logs'\)/,
    'auditLog.js must write to audit_logs, the collection the docs point at');
});

test('AuditLog model does not collide with the security trail collection', () => {
  // If someone later pins this model to `audit_logs`, the two writers would
  // share a collection with incompatible shapes. That is worse than the
  // current split, so assert it has NOT been pinned.
  assert.ok(!/collection:\s*['"]audit_logs['"]/.test(auditModel),
    'AuditLog must keep its own collection; pinning it to audit_logs would mix two schemas');
  // And it must not be pinned to anything else without updating this test and
  // the naming doc in src/lib/auditLog.js.
  assert.ok(!/collection:\s*['"]/.test(auditModel),
    'AuditLog gained an explicit collection name — update the naming doc in auditLog.js');
});

test('the three trails are documented as distinct collections', () => {
  // The trap is invisible in code review; the only defence is that the comment
  // spells it out. Assert the doc actually names all three.
  for (const name of ['audit_logs', 'auditlogs', 'activitylogs']) {
    assert.ok(auditLib.includes(name),
      `auditLog.js must document the ${name} collection`);
  }
});

test('privileged server actions reach the unified security trail', () => {
  // app-action is the only writer that uses the AuditLog model, and it is the
  // highest-severity route in the product. It must ALSO write to audit_logs.
  assert.ok(appAction.includes("from '@/lib/auditLog'"),
    'app-action must import the shared audit helper');
  assert.match(appAction, /server\.service\.\$\{action\}/,
    'privileged server actions must be namespaced under server.service.*');

  // The call must sit inside writeAudit, before the model write, so a failure
  // in the typed write cannot silently skip the security trail.
  const writeAudit = appAction.slice(
    appAction.indexOf('async function writeAudit'),
    appAction.indexOf('const db = await connectDB();')
  );
  assert.ok(writeAudit.includes('auditLog('),
    'auditLog() must be called first inside writeAudit');
});

test('server action audit captures connection, app and outcome', () => {
  const writeAudit = appAction.slice(
    appAction.indexOf('async function writeAudit'),
    appAction.indexOf('const db = await connectDB();')
  );
  for (const field of ['connectionId', 'appName', 'exitCode']) {
    assert.ok(writeAudit.includes(field),
      `server action audit must record ${field} for post-incident review`);
  }
  assert.match(writeAudit, /success \? 'success' : 'failure'/,
    'server action audit must record the outcome');
});

test('ActivityLog stays a separate user-facing timeline', () => {
  // Deliberately NOT unified: this is a product feature (the UI timeline), not
  // a compliance trail. Assert it keeps its own enum-constrained shape so it
  // cannot drift into being a second audit log.
  assert.ok(activityModel.includes("category:"), 'ActivityLog keeps its category field');
  assert.ok(activityModel.includes("'sync'"), 'ActivityLog keeps its category enum');
  assert.ok(!activityModel.includes('audit_logs'),
    'ActivityLog must not write into the security trail');
});
