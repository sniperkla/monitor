# Incident Response Plan — monitor.eaqdragon.com

> Drafted 2026-09-05. Read `THREAT_MODEL.md` first — it defines the assets and the
> boundaries this plan assumes.
>
> The one thing to internalise: **this application holds live SSH credentials and a
> working shell on user-owned servers.** A compromise here is not a data-breach
> notification exercise; it is "assume every connected host is compromised until
> proven otherwise".

---

## 1. Severity levels

| Sev | Definition | Response | Notify |
|---|---|---|---|
| **S1** | Credentials to monitored servers exposed or suspected exposed; MongoDB exposed; `ENCRYPTION_KEY` exposed; RCE on the monitor host | Immediate, all-hands | All users, within 72h |
| **S2** | Session hijack of a single account; relay token leaked; agent gateway takeover | Within 1 hour | Affected user(s) |
| **S3** | Reconnaissance, scanning, rate-limit abuse, failed-login campaigns | Within 24 hours | Internal only |
| **S4** | Noise, advisories with no viable path, informational | Next business day | Internal only |

Anything involving A1 (SSH credentials) defaults to **S1** until evidence says
otherwise. Downgrading is a decision, not a default.

---

## 2. First 30 minutes — do these in order

1. **Contain before you investigate.** Revoke the session, the API key, the relay token.
   You can always restore access; you cannot un-leak a credential.
2. **Do not delete anything.** No log rotation, no container restart, no `npm ci` on the
   affected host. Evidence preservation outranks tidiness.
3. **Snapshot MongoDB** before any remediation write.
4. **Record the timeline in writing**, with wall-clock times and who did what.

---

## 3. Runbooks

### R1 — SSH credentials may be exposed (S1)

Assume T1 or T2 from the threat model.

1. Rotate `ENCRYPTION_KEY` **and** `NEXTAUTH_SECRET` — the derived key is
   `sha256(ENCRYPTION_KEY || NEXTAUTH_SECRET)`, so rotating only one still changes it,
   but rotate both.
   - Keep the outgoing value as `ENCRYPTION_KEY_OLD` so existing records still decrypt.
   - Then **re-encrypt every `connections` document** and retire `_OLD`.
   - Records encrypted under a key that is no longer available cannot be recovered.
     That is why step 4 exists.
2. Rotate SSH keys/credentials on **every** monitored host, and on the hosts' own
   `authorized_keys`.
3. Revoke all sessions, all API keys, all relay tokens.
4. Notify users: their servers must be treated as compromised, and they should rotate
   any credential that transited those hosts.
5. Review the audit log for `connection.*` and `ssh.*` actions in the exposure window —
   **after** restoring it from the pre-remediation snapshot if there is any chance it
   was edited (see T6).

### R2 — Session hijack, single account (S2)

1. Revoke that user's sessions immediately.
2. Force re-enrolment of MFA / passkeys.
3. Pull the audit log for that user id: `auth.login.*`, `connection.*`, `user.api-keys.*`.
4. Treat their monitored servers as exposed if any `ssh.*` action is unexplained —
   escalate to R1.
5. Check whether the source IP also appears against other accounts; if so, escalate to
   S1 — you have a common-origin problem, not a single-account one.

### R3 — RCE or host compromise on the monitor server (S1)

1. Take the host out of rotation (Cloudflare / nginx) — do not just stop the app.
2. Preserve the host for forensics; rebuild rather than clean.
3. Treat this as R1: everything the host could decrypt is exposed.
4. Rotate **every** secret the host could read: `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`,
   `GOOGLE_CLIENT_SECRET`, `UPSTASH_*`, R2 keys, relay tokens, deploy webhook secret.

### R4 — MongoDB exposed (S1)

1. Restrict network access to the app host — this is the containment step, do it first.
2. Enable TLS + SCRAM authentication.
3. Then run R1 in full: assume `connections` was read and `users` was edited.
4. Specifically audit for **privilege escalation**: any `role` change on any user
   outside the known admin set. This is the attack that skips all the crypto.

### R5 — Leaked agent bootstrap secret / agent gateway takeover (S2)

Relevant because the gateway can run open (T5).

1. Rotate the agent's `tokenIssueSecret` / `token` on the remote host and restart the
   gateway.
2. Revoke the affected user's relay tokens; the tunnel is only as private as the token.
3. Assume anything typed into that agent's Web UI during the exposure window is known.

---

## 4. Evidence

Preserve, in order of volatility:

1. Process list and open network connections on the affected host.
2. MongoDB snapshot (before remediation writes).
3. Application logs — `server.js` stdout, and the audit collection.
4. Cloudflare / nginx access logs (these survive an app-host rebuild).
5. CI and Dependabot history — establishes what code was running when.

Known limitation, stated plainly: **the audit log lives in the same database the
attacker would compromise, so it is corroborating evidence, not primary evidence.**
Ship it externally (T6) if you want it to stand on its own.

---

## 5. Notification

- **Users:** what happened, which of their assets were in scope, what you have already
  done, what they must do. No speculation on attribution.
- **Third parties:** Google (OAuth), Cloudflare, Upstash, R2 — per their terms, if their
  service or credentials were involved.
- Timing: S1 within 72 hours of confirmation, even if the investigation is incomplete.
  An incomplete notification beats a late one.

---

## 6. After the incident

- Blameless post-mortem within 5 business days.
- Update `THREAT_MODEL.md` with the path that was actually used — a threat model that
  did not predict the incident is the thing to fix first.
- Convert each "we should have" into a tracked item with an owner. Unowned follow-ups
  are how the same incident happens twice.

---

## 7. Gaps in this plan

Being honest about what is not yet in place:

- No named on-call rotation or escalation contacts — fill these in before you need them.
- No tested backup restore. An untested restore procedure is a hypothesis.
- Rotation of `ENCRYPTION_KEY` has never been rehearsed (R1 step 1). Rehearse it on a
  copy before an incident forces you to do it live.
- No external log sink, so audit evidence is not independently trustworthy (T6).
