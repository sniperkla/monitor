import { randomBytes, randomInt } from 'crypto';
import { checkRateLimit } from '@/lib/serverGuard';
import { safeEqual } from '@/lib/csrf';
import { getSupporterStatus } from '@/utils/supporter';
import { issueRelayToken, persistRelayTokens, sanitizeLabel } from '@/lib/relayTokens';

/**
 * Relay device pairing — an RFC 8628 style flow so the person installing the
 * relay never handles a credential.
 *
 * WHY THIS EXISTS
 * ---------------
 * The install step used to be the scariest screen in the product:
 *
 *   node local-relay.js --install --server https://… --token <365_DAY_TOKEN>
 *
 * That put a long-lived bearer token into the process table (`ps aux` shows
 * argv to every local user), into ~/.bash_history, and into the body of a
 * .sh/.bat sitting in ~/Downloads. Anyone who read it owned that user's relay
 * until it expired or a human happened to revoke it. Unsurprisingly, users
 * bounced.
 *
 * The fix is not "warn them louder". It is to remove the secret from the
 * terminal entirely:
 *
 *   1. The agent asks for a device code. The install command carries NO secret.
 *   2. The agent prints a short code — K7QP-2M4X.
 *   3. The user types that code into Settings while already signed in.
 *   4. The agent's next poll returns the token, which it writes 0600.
 *
 * The token never appears in argv, history, or a downloaded file.
 *
 * WHAT THE CODE IS AND IS NOT
 * ---------------------------
 * `userCode` is a claim ticket, not a credential. Possessing it lets you link
 * a device to *your own* session — it cannot be exchanged for a token by
 * itself, and it does not authenticate anything to anyone else. Guessing one
 * only lets an attacker attach their device to their own account.
 *
 * `deviceCode` is the real bearer until it is exchanged, so it gets 256 bits,
 * a 10 minute life, and single use.
 *
 * SCOPE GATE
 * ----------
 * 'relay' scope requires an active supporter membership, checked at APPROVAL
 * time rather than at code creation. The agent runs unauthenticated, so
 * checking at creation would surface a 403 in a terminal where nobody can act
 * on it. Checking at approval puts the error in the browser, in front of the
 * user, while they are already looking at the upgrade prompt.
 */

/** How long an enrollment lives. Long enough to type a code, short enough to bound guessing. */
export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;

/** Poll cadence the agent should use. */
export const POLL_INTERVAL_SEC = 5;

/**
 * User code alphabet — Crockford-style, with I, L, O, 0 and 1 removed.
 * The code is transcribed by a human from a terminal to a browser, so every
 * ambiguous glyph pair is a support ticket. 30^8 ≈ 2^39 combinations.
 */
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const USER_CODE_LENGTH = 8;

/** Issuance throttle per IP. A machine enrolls once, not hundreds of times. */
const ENROLL_RATE_LIMIT = 20;

/** Approval attempts per user. Bounds user-code guessing from a signed-in session. */
const APPROVE_RATE_LIMIT = 30;

/**
 * Failed-approval lockout. A signed-in attacker throwing user codes at this
 * endpoint is guessing out of ~30^8, so this is defence in depth rather than
 * the primary control — but it caps the attempt rate at something far below
 * the issuance throttle and makes credential stuffing visibly slow.
 *
 * Only well-formed-but-unmatched codes count. Malformed input is far more
 * likely a genuine copy/paste error than an attack, and charging a user a
 * lockout for fumbling their own code is a bad trade.
 */
const FAILURE_LIMIT = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

function failureStore() {
  global.__relayPairingFailures = global.__relayPairingFailures || new Map();
  return global.__relayPairingFailures;
}

function registerFailure(userId, now = Date.now()) {
  const failures = failureStore();
  const prev = failures.get(userId);
  if (!prev || now - prev.windowStart > FAILURE_WINDOW_MS) {
    failures.set(userId, { count: 1, windowStart: now });
    return 1;
  }
  prev.count += 1;
  return prev.count;
}

function lockoutRemaining(userId, now = Date.now()) {
  const entry = failureStore().get(userId);
  if (!entry || entry.count < FAILURE_LIMIT) return 0;
  const elapsed = now - entry.windowStart;
  return Math.max(0, FAILURE_WINDOW_MS - elapsed);
}

/** Exchange polls are cheap but must not be a free DoS amplifier. */
const EXCHANGE_RATE_LIMIT = 240;

function store() {
  global.__relayDeviceCodes = global.__relayDeviceCodes || new Map();
  return global.__relayDeviceCodes;
}

/** Drop enrollments that outlived their TTL. Called opportunistically. */
function sweepExpired(now = Date.now()) {
  const codes = store();
  for (const [deviceCode, e] of codes) {
    if (e.expiresAt <= now) codes.delete(deviceCode);
  }
}

if (!global.__relayPairingSweeperStarted) {
  global.__relayPairingSweeperStarted = true;
  setInterval(() => sweepExpired(), 60 * 1000).unref?.();
}

function generateUserCode(codes) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let raw = '';
    for (let i = 0; i < USER_CODE_LENGTH; i++) {
      raw += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    let taken = false;
    for (const e of codes.values()) {
      if (e.userCode === formatted) {
        taken = true;
        break;
      }
    }
    if (!taken) return formatted;
  }
  throw new Error('Could not allocate a unique relay pairing code');
}

/**
 * Normalize whatever a human typed into the canonical XXXX-XXXX form.
 * Accepts lowercase, missing dash, and stray whitespace, because people copy
 * from terminals that wrap.
 */
export function normalizeUserCode(input) {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== USER_CODE_LENGTH) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/**
 * Step 1 — an agent asks for a device code. Unauthenticated by design.
 *
 * @param {object} args
 * @param {string} args.client       'local-relay' | 'server-agent'
 * @param {string} [args.label]      human-readable machine name
 * @param {string} [args.ip]         used only for the issuance throttle
 * @param {'relay'|'agent'} [args.scope]
 */
export function createEnrollment({ client = 'unknown', label = null, ip = 'unknown', scope = 'agent' }) {
  const limit = checkRateLimit(`relay-pair:${ip}`, ENROLL_RATE_LIMIT);
  if (!limit.allowed) {
    return { error: `Too many pairing requests. Retry in ${Math.ceil(limit.resetIn / 1000)}s.` };
  }

  const codes = store();
  sweepExpired();

  // Bound total pending enrollments so an attacker cannot park unlimited
  // entries in memory. Legitimate use is a handful at a time.
  if (codes.size > 5000) return { error: 'Pairing is temporarily unavailable. Try again shortly.' };

  const deviceCode = randomBytes(32).toString('base64url');
  const userCode = generateUserCode(codes);
  const now = Date.now();

  codes.set(deviceCode, {
    deviceCode,
    userCode,
    client: String(client).slice(0, 40),
    label: sanitizeLabel(label),
    scope: scope === 'relay' ? 'relay' : 'agent',
    status: 'pending',
    userId: null,
    email: null,
    approvedAt: null,
    createdAt: now,
    expiresAt: now + DEVICE_CODE_TTL_MS,
    ip,
  });

  return {
    deviceCode,
    userCode,
    expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    interval: POLL_INTERVAL_SEC,
  };
}

/**
 * Mint a PRE-AUTHORIZED enrollment for the calling user.
 *
 * Used when the install is driven from the browser — the Agent Setup Wizard
 * reaches a server over SSH and cannot show the user a terminal. The user is
 * already signed in, so there is nothing to approve: the browser mints a
 * single-use claim code, the agent exchanges it immediately, and the user
 * types nothing at all.
 *
 * The code does pass through the remote server's argv for the few seconds the
 * install runs. That is why it is single-use, 10 minute lived, and consumed
 * immediately — versus the alternative it replaces, a 365-day token written
 * permanently into the systemd unit.
 *
 * `scope: 'relay'` still requires supporter membership; the caller checks that
 * before minting so the user sees the upgrade prompt in the browser.
 */
export function createInvite({
  userId,
  email = null,
  scope = 'agent',
  label = null,
  client = 'server-agent',
  ip = 'unknown',
}) {
  const limit = checkRateLimit(`relay-invite:${userId}`, ENROLL_RATE_LIMIT);
  if (!limit.allowed) {
    return { error: `Too many install codes requested. Retry in ${Math.ceil(limit.resetIn / 1000)}s.` };
  }

  const codes = store();
  sweepExpired();
  if (codes.size > 5000) return { error: 'Pairing is temporarily unavailable. Try again shortly.' };

  const deviceCode = randomBytes(32).toString('base64url');
  const now = Date.now();

  codes.set(deviceCode, {
    deviceCode,
    userCode: null, // nothing to type — already bound to a signed-in user
    client: String(client).slice(0, 40),
    label: sanitizeLabel(label),
    scope: scope === 'relay' ? 'relay' : 'agent',
    status: 'approved',
    userId,
    email,
    approvedAt: now,
    createdAt: now,
    expiresAt: now + DEVICE_CODE_TTL_MS,
    ip,
  });

  return { claimCode: deviceCode, expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000) };
}

/** Constant-time lookup by the short human code. */
export function findByUserCode(userCode) {
  const codes = store();
  sweepExpired();
  for (const e of codes.values()) {
    if (e.status !== 'pending') continue;
    if (safeEqual(e.userCode, userCode)) return e;
  }
  return null;
}

/**
 * Step 2 — the signed-in user approves a code.
 *
 * @param {object} args
 * @param {string} args.userCode  normalized caller-side, normalized again here
 * @param {string} args.userId
 * @param {string} [args.email]
 * @param {string} [args.ip]
 */
export async function approveEnrollment({ userCode, userId, email = null, ip = 'unknown' }) {
  const limit = checkRateLimit(`relay-approve:${userId}`, APPROVE_RATE_LIMIT);
  if (!limit.allowed) {
    return { ok: false, error: `Too many attempts. Retry in ${Math.ceil(limit.resetIn / 1000)}s.` };
  }

  const now = Date.now();
  const remaining = lockoutRemaining(userId, now);
  if (remaining > 0) {
    return {
      ok: false,
      error: `Too many incorrect codes. Try again in ${Math.ceil(remaining / 60000)} minute(s).`,
    };
  }

  const normalized = normalizeUserCode(userCode);
  // Malformed input is a likely paste error, not an attack — do not charge it
  // against the lockout.
  if (!normalized) return { ok: false, error: 'That code is not valid.' };

  const entry = findByUserCode(normalized);
  if (!entry) {
    registerFailure(userId, now);
    return { ok: false, error: 'No pending setup request found for that code.' };
  }

  if (entry.scope === 'relay') {
    const status = await getSupporterStatus(email);
    if (!status.isSupporter) {
      return { ok: false, error: 'SUPPORTER_REQUIRED', requiresSupporter: true };
    }
  }

  entry.status = 'approved';
  entry.userId = userId;
  entry.email = email;
  entry.approvedAt = now;
  entry.approvedFrom = ip;

  // A successful approval clears the lockout counter so a user who fumbled a
  // few codes is not punished later for an unrelated install.
  failureStore().delete(userId);

  return { ok: true, entry };
}

/**
 * Step 3 — the agent polls until approved, then exchanges the device code for
 * a real relay token. Single use: a successful exchange consumes the entry.
 *
 * @param {object} args
 * @param {string} args.deviceCode
 * @param {string} [args.ip]
 */
export async function exchangeEnrollment({ deviceCode, ip = 'unknown' }) {
  const limit = checkRateLimit(`relay-exchange:${ip}`, EXCHANGE_RATE_LIMIT);
  if (!limit.allowed) {
    return { status: 'slow_down', error: 'Polling too quickly.' };
  }

  const codes = store();
  sweepExpired();

  if (!deviceCode || typeof deviceCode !== 'string') {
    return { status: 'invalid', error: 'Missing device code.' };
  }

  const entry = codes.get(deviceCode);
  if (!entry) {
    // Indistinguishable from "wrong code" on purpose — no oracle for whether
    // a given device code ever existed.
    return { status: 'expired', error: 'This setup code expired. Run the install command again.' };
  }

  if (entry.status !== 'approved') {
    const remainingMs = entry.expiresAt - Date.now();
    return {
      status: 'pending',
      expiresIn: Math.max(0, Math.floor(remainingMs / 1000)),
    };
  }

  // Single use: consume before minting so a replay cannot mint twice.
  codes.delete(deviceCode);

  const { token, expiresAt } = issueRelayToken({
    userId: entry.userId,
    email: entry.email,
    scope: entry.scope,
    label: entry.label,
    pairingId: entry.userCode,
  });

  await persistRelayTokens();

  return {
    status: 'ok',
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    scope: entry.scope,
    label: entry.label,
  };
}
