// ── Regression tests for the newly reported security findings ───────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const csrf = readSrc('src/lib/csrf.js');
const search = readSrc('src/app/api/skills/search/route.js');
const terminal = readSrc('src/components/TerminalView.js');
const vaultRoute = readSrc('src/app/api/user/vault/route.js');
const vaultContext = readSrc('src/context/VaultContext.js');

test('CSRF design is an intentional double-submit token, not a forged token', () => {
  assert.ok(csrf.includes('header === cookie'), 'double-submit equality is documented');
  assert.ok(csrf.includes('HMAC(secret'), 'token is signed');
  assert.ok(csrf.includes('userId'), 'token is user-bound');
  assert.match(csrf, /httpOnly:\s*true/, 'cookie is HttpOnly — audit finding "monitor_csrf missing HttpOnly"');
  // The black-box claim that document.cookie alone is sufficient is false: the
  // token is valid only when the attacker can also induce a same-origin header,
  // and the HMAC is checked against the authenticated user.
  assert.ok(csrf.includes('return verifyCsrfToken(cookieToken, userId)'));
});

test('CSRF cookie is HttpOnly and the client gets the token from the body', () => {
  const client = readSrc('src/utils/csrfClient.js');
  assert.match(csrf, /httpOnly:\s*true/, 'csrfCookieOptions must set httpOnly: true');
  assert.match(client, /let cachedToken = null/, 'client caches the body-provided token');
  assert.match(client, /data\.csrfToken/, 'token comes from the /api/csrf response body');
  assert.ok(client.includes('readCookie(CSRF_COOKIE)'), 'cookie kept as fallback');
});

test('/api/csrf bootstrap is rate limited and idempotent', () => {
  const route = readSrc('src/app/api/csrf/route.js');
  assert.match(route, /checkRateLimit\('csrf'/, 'unauthenticated bootstrap must be rate limited');
  assert.match(route, /verifyCsrfToken\(existing, userId\)/,
    'a still-valid cookie token must be re-served, not rotated (multi-tab churn)');
  assert.match(route, /status: 429/, 'over-limit requests are rejected');
});

test('skills/install cap is 5/min (scanner previously read the 10-cap as "no limit")', async () => {
  const { ruleForPath } = await import('../src/lib/ratelimit.js');
  const rule = ruleForPath('/api/skills/install');
  assert.equal(rule.limit, 5);
  assert.equal(rule.window, '1 m');
});

test('SkillsMP search now requires an authenticated session', () => {
  assert.match(search, /const session = await getServerSession\(authOptions\)/);
  assert.match(search, /if \(!session\)[\s\S]{0,150}status: 401/);
  assert.ok(!search.includes('proceeding with API key auth only'));
});

test('external skills are not silently auto-installed', () => {
  assert.ok(terminal.includes('require explicit user review'));
  assert.ok(terminal.includes('Do not silently'));
  // The former automatic install call in fetchSkillsForGoal must not return.
  const searchBlock = terminal.slice(terminal.indexOf('// ── Step 2: Try external SkillsMP'), terminal.indexOf('// ── Step 3: Inject skills'));
  assert.ok(!searchBlock.includes("apiFetch('/api/skills/install'"),
    'search results must not write to the local skill namespace automatically');
});

test('vault GET does not return passwordHash', () => {
  const getBlock = vaultRoute.slice(vaultRoute.indexOf('export async function GET'), vaultRoute.indexOf('/**\n * POST'));
  assert.ok(getBlock.includes('encryptedUri'));
  assert.ok(getBlock.includes('salt'));
  assert.ok(getBlock.includes('iv'));
  assert.ok(!getBlock.includes('passwordHash: user.vault'),
    'password verifier must not be sent to the browser');
});

test('vault client verifies by authenticated decryption', () => {
  const verifyBlock = vaultContext.slice(vaultContext.indexOf('const verifyMasterPassword'), vaultContext.indexOf('const value = useMemo'));
  assert.ok(verifyBlock.includes('decryptWithPassword'));
  assert.ok(!verifyBlock.includes('vaultData.passwordHash'));
  const unlockBlock = vaultContext.slice(vaultContext.indexOf('const unlockVault'), vaultContext.indexOf('const setupVault'));
  assert.ok(!unlockBlock.includes('vaultData.passwordHash'));
});

test('no dynamic JavaScript evaluator is used for skill content', () => {
  const source = [
    readSrc('src/components/TerminalView.js'),
    readSrc('src/apps/AIAgentsApp.js'),
    readSrc('src/app/api/skills/search/route.js'),
    readSrc('src/app/api/skills/local/route.js'),
  ].join('\n');
  assert.ok(!/\bnew\s+Function\s*\(/.test(source));
  assert.ok(!/\beval\s*\(/.test(source));
  assert.ok(!/vm\.run(?:InNewContext|InContext)?\s*\(/.test(source));
});
