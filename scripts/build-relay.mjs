#!/usr/bin/env node
/**
 * Build a shipped artifact (local relay, server agent) from its source.
 *
 *   public/local-relay.js      readable source — the thing humans edit
 *   public/local-relay.min.js  obfuscated artifact — the thing we serve
 *
 * WHY THE SPLIT EXISTS AT ALL
 * ---------------------------
 * The relay runs on the user's machine, so we can never truly hide it. What
 * this buys is deterrence, not secrecy: it stops casual copy-paste and raises
 * the effort of lifting the implementation to "run a deobfuscator" instead of
 * "open the file". Say so honestly rather than pretending it is protection.
 *
 * WHY IT IS DETERMINISTIC (seed)
 * ------------------------------
 * A build whose bytes change on every run cannot be checksummed, and an
 * artifact that cannot be checksummed cannot be drift-checked. A fixed seed
 * makes the output a pure function of the source, so the release manifest
 * publishes a stable digest and `scripts/relay-install-audit.mjs` can verify it.
 *
 * WHY THE ARTIFACT DECLARES THE SOURCE HASH
 * -----------------------------------------
 * The failure mode that made this split dangerous before was a *stale* bundle:
 * an old minified copy silently outranked newer source and every relay restart
 * downgraded itself. The artifact therefore carries `source-sha256` in its
 * header, and anything can cheaply prove the artifact came from the current
 * source. Staleness becomes a detectable error instead of a silent regression.
 *
 * Usage:
 *   node scripts/build-relay.mjs                      build the relay if stale
 *   node scripts/build-relay.mjs --target agent       build the server agent
 *   node scripts/build-relay.mjs --force              always rebuild
 *   node scripts/build-relay.mjs --check              verify only, never write
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JavaScriptObfuscator = require('javascript-obfuscator');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// ONE builder, TWO artifacts.
//
// The server agent used to be built by a separate one-liner (`build:agent`,
// plain `javascript-obfuscator` with no seed and no stamp). It drifted badly:
// the shipped public/monitor-agent.min.js sat at an Aug 23 build while the UI
// had moved to `--claim` install snippets on Sep 6, so a freshly downloaded
// agent understood neither --claim nor --pair and every agent install was
// silently broken. Nothing checked, because nothing could — the artifact
// carried no record of what it was built from.
//
// Both targets now go through this script, so the agent inherits determinism,
// the source-sha256 stamp and the --check gate for free.
const TARGETS = {
  relay: {
    source: 'public/local-relay.js',
    out: 'public/local-relay.min.js',
    title: 'Local Relay',
  },
  agent: {
    source: 'public/monitor-agent.js',
    out: 'public/monitor-agent.min.js',
    title: 'Server Agent',
  },
};

const argVal = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const TARGET = TARGETS[argVal('--target') || 'relay'];
if (!TARGET) {
  console.error(`❌ Unknown --target. Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

const SOURCE = path.join(root, TARGET.source);
const OUT = path.join(root, TARGET.out);

// Used in the messages below. Getting these wrong is how "the relay artifact
// is stale" gets reported while you are debugging the agent.
const targetName = argVal('--target') || 'relay';
const label = TARGET.title;
const buildCmd = targetName === 'relay' ? 'npm run build:relay' : 'npm run build:agent';

const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');

/** Fixed seed — see "WHY IT IS DETERMINISTIC" above. */
const SEED = 20260906;

const HEADER = `/*!
 * SSH Monitor — ${TARGET.title}
 *
 * PROPRIETARY AND CONFIDENTIAL. This file is part of a private, non-public
 * product. You are licensed to RUN it as part of using SSH Monitor. You are
 * not granted any right to copy, modify, distribute, sublicense, decompile,
 * or create derivative works from it. See the LICENSE file distributed with
 * this script for the full terms.
 *
 * This build is intentionally compressed. It is generated from the project's
 * own source by scripts/build-relay.mjs and has not been hand-edited.
 */
`;

const OBFUSCATION_OPTIONS = {
  compact: true,
  seed: SEED,
  target: 'node',

  // Identifier renaming is the bulk of the deterrence. `renameGlobals` has to
  // be ON here: the relay is one self-contained script, so with it off every
  // top-level function name survives verbatim (ensureInstalledScript,
  // pairAndGetToken, …) and the build barely obscures anything.
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,

  // String extraction, encoded so the literals are not greppable. Threshold 1
  // pulls in *every* string — at 0.75 the package name and service name leaked
  // straight through, which is exactly the kind of thing someone greps for.
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,

  // Deliberately OFF. These are the options that break real code: they rewrite
  // control flow or inject branches, and the relay resolves modules through a
  // dynamic require() search path that those transforms have corrupted before.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  transformObjectKeys: false,
  splitStrings: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Read the `source-sha256` the artifact claims to have been built from. */
function declaredSourceHash(text) {
  const m = text.match(/source-sha256:\s*([0-9a-f]{64})/);
  return m ? m[1] : null;
}

function artifactHeader(sourceHash) {
  return `${HEADER}\n/* source-sha256: ${sourceHash} */\n/* generator: scripts/build-relay.mjs seed=${SEED} */\n`;
}

/**
 * The complete artifact text, byte for byte.
 *
 * Build and --check MUST share this. They did not at first: check compared a
 * string without the trailing newline the build path appended, so `--check`
 * failed on an artifact that was perfectly current — a false alarm that made
 * the drift gate look broken and invites someone to "fix" it by deleting the
 * gate. Same function, same bytes, no way for the two paths to disagree.
 */
function buildArtifact(sourceText, sourceHash) {
  const { shebang, body } = splitShebang(sourceText);
  // The license header has to sit after the shebang, or the shebang stops being
  // a shebang and the file will not execute.
  return shebang + artifactHeader(sourceHash) + obfuscate(body) + '\n';
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ Missing source: ${SOURCE}`);
    process.exit(1);
  }

  const sourceBuf = fs.readFileSync(SOURCE);
  const sourceHash = sha256(sourceBuf);

  if (fs.existsSync(OUT)) {
    const existing = fs.readFileSync(OUT, 'utf8');
    if (declaredSourceHash(existing) === sourceHash && !FORCE) {
      const kb = (Buffer.byteLength(existing) / 1024).toFixed(0);
      console.log(`${label} artifact current (${kb} KB) — source ${sourceHash.slice(0, 12)}…`);
      if (CHECK) {
        // Deterministic build: identical source must produce identical bytes.
        const rebuilt = buildArtifact(sourceBuf.toString('utf8'), sourceHash);
        if (sha256(Buffer.from(rebuilt)) !== sha256(Buffer.from(existing))) {
          console.error('❌ Artifact does not match a fresh build of this source.');
          process.exit(2);
        }
        console.log('artifact matches a fresh deterministic build');
      }
      return;
    }
    if (CHECK) {
      console.error(`❌ ${label} artifact is stale — built from ${declaredSourceHash(existing) || 'unknown'}, source is ${sourceHash}.`);
      console.error(`   Run: ${buildCmd}`);
      process.exit(2);
    }
  } else if (CHECK) {
    console.error(`❌ ${label} artifact missing: ${OUT}`);
    console.error(`   Run: ${buildCmd}`);
    process.exit(2);
  }

  console.log(`obfuscating ${(sourceBuf.length / 1024).toFixed(0)} KB of source…`);
  const out = buildArtifact(sourceBuf.toString('utf8'), sourceHash);

  fs.writeFileSync(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`✅ wrote ${path.relative(root, OUT)} (${kb} KB)`);
  console.log(`   source-sha256 ${sourceHash}`);
  console.log(`   artifact-sha256 ${sha256(Buffer.from(out))}`);
}

function obfuscate(code) {
  return JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS).getObfuscatedCode();
}

/**
 * Split off a leading shebang.
 *
 * The obfuscator hoists its own string-array wrapper above everything else, so
 * a `#!` line left in the source ends up on line 16 — after real code — where
 * Node rejects it with `SyntaxError: Invalid or unexpected token`. Pull it out
 * before obfuscating and put it back as the very first line.
 */
function splitShebang(code) {
  const m = code.match(/^(#![^\n]*\n)/);
  return m ? { shebang: m[1], body: code.slice(m[1].length) } : { shebang: '', body: code };
}

main();
