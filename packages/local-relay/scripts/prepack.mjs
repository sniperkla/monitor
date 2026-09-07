#!/usr/bin/env node

/**
 * prepack — build the published tarball.
 *
 * Runs on the PUBLISHER's machine only. npm never executes prepack on a
 * consumer's machine, so this adds no install-time behaviour for users.
 *
 * What it does, and nothing else:
 *   1. copy ../../public/local-relay.min.js  ->  dist/local-relay.js
 *   2. mark bin/local-relay.js executable
 *   3. print the SHA-256 and byte count of what is about to be published
 *
 * Why the ARTIFACT and not the source: public/local-relay.min.js is what the
 * server hands out at GET /local-relay.js. Publishing a different build would
 * mean npm users and curl users run different code, and a checksum published
 * for one would not match the other. One artifact, everywhere.
 *
 * It refuses to run against a stale artifact, which is the failure mode that
 * made maintaining a built file dangerous before — see scripts/build-relay.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// .mjs is ESM regardless of package.json "type", so there is no __dirname.
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(PKG_ROOT, '..', '..', 'public', 'local-relay.min.js');
const DEST_DIR = path.join(PKG_ROOT, 'dist');
const DEST = path.join(DEST_DIR, 'local-relay.js');
const BIN = path.join(PKG_ROOT, 'bin', 'local-relay.js');

if (!fs.existsSync(SOURCE)) {
  console.error(`prepack: source not found: ${SOURCE}`);
  process.exit(1);
}

const buf = fs.readFileSync(SOURCE);
if (buf.length < 1024) {
  console.error(`prepack: source looks truncated (${buf.length} bytes) — refusing to publish.`);
  process.exit(1);
}

// Sanity: the relay must still be a directly runnable script.
if (!buf.subarray(0, 2).equals(Buffer.from('#!'))) {
  console.error('prepack: source is missing its shebang — it is not a runnable script.');
  process.exit(1);
}

// Refuse to publish an artifact built from someone else's source. The header
// carries the sha256 of the readable source it was generated from; if that no
// longer matches, `npm run build:relay` was not re-run after an edit.
const sourceFile = SOURCE.replace(/local-relay\.min\.js$/, 'local-relay.js');
const declared = String(buf).match(/source-sha256:\s*([0-9a-f]{64})/);
if (fs.existsSync(sourceFile)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
  if (!declared) {
    console.error('prepack: artifact has no source-sha256 header — rebuild with scripts/build-relay.mjs.');
    process.exit(1);
  }
  if (declared[1] !== actual) {
    console.error('prepack: artifact is STALE.');
    console.error(`  artifact built from ${declared[1]}`);
    console.error(`  current source is   ${actual}`);
    console.error('  Run: npm run build:relay');
    process.exit(1);
  }
}

fs.mkdirSync(DEST_DIR, { recursive: true });
fs.writeFileSync(DEST, buf);
fs.chmodSync(DEST, 0o755);
fs.chmodSync(BIN, 0o755);

const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

console.log(`prepack: dist/local-relay.js  ${buf.length} bytes`);
console.log(`prepack: sha256               ${sha256}`);
console.log('prepack: source of truth      public/local-relay.min.js (also served at /local-relay.js)');
console.log(`prepack: built from source    ${declared ? declared[1] : '(unknown)'}`);
