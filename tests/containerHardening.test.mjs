// ── Regression test: the runtime container must not run as root ──
//
// A security report argued that an arbitrary file write in the Next.js process
// would be an RCE "if the Next.js process runs as root in the container (common
// in PaaS deployments)". The write itself was a false positive (see
// skillInstallStrictBody.test.mjs), but the ROOT question was a fair one and the
// answer was bad: the Dockerfile had no USER directive at all, so the app really
// did run as root.
//
// Running as an unprivileged user is worth keeping regardless of any specific
// vulnerability: it turns any future write or execution primitive into one
// confined to a non-root uid, rather than full control of the container.
//
// These assertions catch the two ways this silently regresses:
//   1. the USER directive being dropped;
//   2. a new COPY being added without --chown, which leaves that path root-owned
//      and therefore unwritable by the app user at runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

/** The last (runtime) stage — everything after the final FROM. */
function runnerStage() {
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)];
  assert.ok(froms.length > 0, 'no FROM found in Dockerfile');
  return dockerfile.slice(froms[froms.length - 1].index);
}

test('the runtime stage declares a non-root user', () => {
  const stage = runnerStage();
  const user = stage.match(/^USER\s+(\S+)/m);
  assert.ok(user, 'the runtime stage has no USER directive — the app would run as root');
  assert.notEqual(user[1], 'root', 'USER must not be root');
});

test('every COPY in the runtime stage is chowned to the runtime user', () => {
  const stage = runnerStage();
  const user = stage.match(/^USER\s+(\S+)/m);
  assert.ok(user, 'no USER directive, so the chown target cannot be determined');

  const copies = [...stage.matchAll(/^COPY\s+(.*)$/gm)].map((m) => m[1]);
  assert.ok(copies.length > 0, 'no COPY instructions found in the runtime stage');

  const expected = `--chown=${user[1]}:${user[1]}`;
  const unchowned = copies.filter((c) => !c.includes(expected));
  assert.deepEqual(
    unchowned,
    [],
    `these COPY lines omit ${expected}, leaving the copied paths root-owned and ` +
      `unwritable by USER ${user[1]} at runtime:\n` +
      unchowned.map((c) => `  COPY ${c}`).join('\n')
  );
});

test('the app does not bind a privileged port', () => {
  // A non-root user cannot bind < 1024, so EXPOSE is a cheap consistency check
  // against the USER directive.
  const stage = runnerStage();
  const expose = stage.match(/^EXPOSE\s+(\d+)/m);
  if (!expose) return;
  const port = Number(expose[1]);
  assert.ok(port >= 1024, `EXPOSE ${port} is privileged and cannot be bound by a non-root user`);
});
