'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  Copy,
  Check,
  Trash2,
  LoaderCircle,
  CircleCheck,
} from 'lucide-react';
import { getCsrfToken, refreshCsrfToken } from '@/utils/csrfClient';

/**
 * The security facts an installer needs before they will paste a command.
 *
 * WHY THIS IS A SEPARATE PANEL
 * ----------------------------
 * The install step is where this product loses people, and it loses them for a
 * good reason: we ask them to download a script and run it on the machine that
 * holds their production keys. Every instinct that makes someone a good
 * operator makes them close that dialog.
 *
 * The previous copy answered with reassurance — "fully end-to-end encrypted",
 * "nothing stored on our servers". Those are unfalsifiable from where the user
 * is standing, so they do no work. What actually reduces the hesitation is
 * giving the user things they can *check*: a checksum, the exact paths the
 * install writes to, the permissions it uses, and the command that removes it.
 *
 * So every claim below is verifiable by the person reading it, and the one
 * claim we cannot fully back — that our server itself is honest — is stated as
 * a limit rather than papered over.
 *
 * The source itself is no longer one of those things: the shipped file is a
 * build. Nothing below claims otherwise — a claim the user can disprove in ten
 * seconds costs more trust than it buys.
 */

/* ── Small building blocks ─────────────────────────────────────────────── */

function CopyButton({ value, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is selectable on screen anyway */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition-colors shrink-0 ${className}`}
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function CodeRow({ children, value, hint }) {
  return (
    <div className="space-y-1">
      <div className="rounded-lg border border-[var(--border-color)] bg-slate-950 overflow-hidden">
        <div className="flex items-start gap-2 p-2.5">
          <code className="flex-1 text-[10px] font-mono text-amber-300 break-all leading-relaxed">
            {children}
          </code>
          <CopyButton
            value={value}
            className="bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/20 text-amber-400"
          />
        </div>
      </div>
      {hint && <p className="text-[9px] text-[var(--text-muted)] leading-relaxed pl-0.5">{hint}</p>}
    </div>
  );
}

function FactRow({ ok, children }) {
  return (
    <li className="flex gap-2">
      <span className={`mt-[3px] shrink-0 ${ok === false ? 'text-amber-400' : 'text-emerald-400'}`}>
        {ok === false ? <ShieldAlert size={11} /> : <ShieldCheck size={11} />}
      </span>
      <span className="text-[10px] leading-relaxed">{children}</span>
    </li>
  );
}

/* ── Verified install commands ─────────────────────────────────────────── */

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function winQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

/**
 * Download + verify + run, as one command that aborts on a mismatch.
 *
 * `shasum -c -` (macOS) and `sha256sum -c -` (Linux) both read the standard
 * `<hash><two spaces><file>` line from stdin, and both exit non-zero when the
 * digest does not match — so `&&` is a real gate, not decoration.
 */
function verifyThenRun({ os, server, sha256, url }) {
  const sha = String(sha256 || '').toLowerCase();

  if (os === 'windows') {
    // Get-FileHash reports uppercase hex, hence .ToUpper() on the literal.
    return [
      `curl -fsSL -H "Cache-Control: no-cache" "${url}" -o local-relay.js`,
      `$h=(Get-FileHash local-relay.js -Algorithm SHA256).Hash.ToUpper(); if ($h -ne '${sha.toUpperCase()}') { Write-Host "CHECKSUM MISMATCH - deleting."; Remove-Item local-relay.js; exit 1 }`,
      `node local-relay.js --pair --server ${winQuote(server)}`,
    ].join('\n');
  }

  const hasher = os === 'macos' ? 'shasum -a 256' : 'sha256sum';
  return [
    `curl -fsSL -H 'Cache-Control: no-cache' "${url}" -o local-relay.js`,
    `echo "${sha}  local-relay.js" | ${hasher} -c -`,
    `node local-relay.js --pair --server ${shellQuote(server)}`,
  ].join('\n');
}

function downloadOnly(url) {
  return `curl -fsSL -H 'Cache-Control: no-cache' "${url}" -o local-relay.js`;
}

/**
 * The npm path — preferred over piping a download into node.
 *
 * Why it is genuinely safer, rather than just feeling safer: the registry
 * verifies the tarball integrity for you, versions are pinnable and auditable,
 * and this package ships NO install lifecycle scripts, so `npm install` cannot
 * execute anything. Nothing runs until the user types `local-relay`.
 */
export const NPM_PACKAGE = 'ssh-monitor-relay';

export function npmInstallCommand({ server }) {
  return [
    `npm install -g ${NPM_PACKAGE}`,
    `local-relay --pair --server ${shellQuote(server)}`,
  ].join('\n');
}

/**
 * Uninstall for the npm route.
 *
 * Order matters: `--uninstall` (which stops the service and removes
 * ~/.ssh-monitor-relay) has to run while the `local-relay` binary still
 * exists, so the `npm uninstall` that removes it comes second.
 */
export function npmUninstallCommand() {
  return [`local-relay --uninstall`, `npm uninstall -g ${NPM_PACKAGE}`].join('\n');
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export default function RelayTrustPanel({ server, detectedOS = 'macos', release = null }) {
  const [showVerify, setShowVerify] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [revokeError, setRevokeError] = useState(null);

  const sha256 = release?.sha256 || null;
  const url = `${server}${release?.url || '/local-relay.js'}`;

  const revokeAll = async () => {
    setRevoking(true);
    setRevokeError(null);

    const doFetch = () =>
      fetch('/api/relay/token', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': getCsrfToken() || '' },
      });

    try {
      let res = await doFetch();
      if (res.status === 403) {
        await refreshCsrfToken();
        res = await doFetch();
      }
      if (!res.ok) throw new Error('Could not revoke relay access.');
      setRevoked(true);
      setConfirmRevoke(false);
    } catch (err) {
      setRevokeError(err.message || 'Could not revoke relay access.');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setShowVerify((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-[var(--text-primary)]">
            Before you run it — what this agent can and cannot do
          </p>
          <p className="text-[9px] text-[var(--text-muted)] mt-0.5">
            {sha256
              ? 'Verified facts, plus a checksum you can check yourself.'
              : 'Verified facts about the install.'}
          </p>
        </div>
        <ChevronDown
          size={14}
          className={`text-[var(--text-muted)] shrink-0 transition-transform ${showVerify ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {showVerify && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 space-y-3.5 border-t border-[var(--border-color)] pt-3">
              {/* Machine-readable facts */}
              <ul className="space-y-1.5 text-[var(--text-secondary)]">
                <FactRow>
                  Runs as <strong className="text-[var(--text-primary)]">your user account</strong>. Install
                  needs no sudo and no root.
                </FactRow>
                <FactRow>
                  Writes a user-level service only —{' '}
                  <code className="text-amber-300">~/Library/LaunchAgents</code> on macOS,{' '}
                  <code className="text-amber-300">~/.config/systemd/user</code> on Linux.
                </FactRow>
                <FactRow>
                  Listens only on <code className="text-amber-300">127.0.0.1</code>. Nothing is exposed to your
                  network or the internet — the agent dials out to this dashboard.
                </FactRow>
                <FactRow>
                  You approve it with an <strong className="text-[var(--text-primary)]">8-character code</strong>.
                  No token is typed, pasted, or shown — it is issued straight to the agent.
                </FactRow>
                <FactRow>
                  The token is stored <code className="text-amber-300">0600</code> in your home directory. It
                  never enters argv, shell history, or the service definition.
                </FactRow>
              </ul>

              {/* Recommended: install from npm */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-[var(--text-secondary)]">
                  Recommended — install from npm
                </p>
                <CodeRow
                  value={npmInstallCommand({ server })}
                  hint="After install, npm puts the package on your computer. You will see dist/local-relay.js — a bundled, obfuscated build, not readable source. You can inspect or hash it before running local-relay. npm install itself runs no install script."
                >
                  {npmInstallCommand({ server })}
                </CodeRow>
              </div>

              {/* Integrity */}
              {sha256 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-[var(--text-secondary)]">
                    Integrity — verify the download yourself
                  </p>

                  <div className="rounded-lg border border-[var(--border-color)] bg-slate-950 p-2.5">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[9px] font-mono text-emerald-300 break-all leading-relaxed">
                        {sha256}
                      </code>
                      <CopyButton
                        value={sha256}
                        className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400"
                      />
                    </div>
                    <p className="text-[9px] text-[var(--text-muted)] mt-1.5">
                      SHA-256 of the file at <code className="text-amber-300">/local-relay.js</code>
                    </p>
                  </div>

                  <CodeRow
                    value={verifyThenRun({ os: detectedOS, server, sha256, url })}
                    hint="Downloads, aborts if the checksum does not match, and only then pairs. Use this instead of the one-liner above if you want the check enforced."
                  >
                    {verifyThenRun({ os: detectedOS, server, sha256, url })}
                  </CodeRow>

                  <CodeRow value={downloadOnly(url)} hint="Or just download it and hold onto it — nothing runs until you execute it yourself.">
                    {downloadOnly(url)}
                  </CodeRow>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">
                  Checksum not available right now — the release manifest could not be read.
                </p>
              )}

              {/* Honest limit */}
              <div className="flex gap-2 p-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
                <ShieldAlert size={12} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-[var(--text-muted)] leading-relaxed">
                  <strong className="text-amber-300">What a checksum does not prove.</strong> The digest is
                  served from the same origin as the file, so it guarantees the download was not corrupted or
                  swapped in transit — it cannot defend against a compromise of this server. That would need an
                  out-of-band code signature, which we do not ship yet.
                </p>
              </div>

              {/* Revoke */}
              <div className="border-t border-[var(--border-color)] pt-3 space-y-2">
                <p className="text-[10px] font-bold text-[var(--text-secondary)]">Change your mind later</p>

                {revoked ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/25">
                    <CircleCheck size={12} className="text-emerald-400 shrink-0" />
                    <p className="text-[10px] text-emerald-300">
                      Relay access revoked. Any connected relay is disconnected now.
                    </p>
                  </div>
                ) : confirmRevoke ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-500/[0.07] border border-rose-500/25">
                    <p className="flex-1 text-[10px] text-[var(--text-secondary)]">
                      Revoke every relay token on your account? Each machine stays installed but goes offline
                      until reinstalled.
                    </p>
                    <button
                      type="button"
                      onClick={revokeAll}
                      disabled={revoking}
                      className="px-2.5 py-1 rounded-md bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-[9px] font-bold transition-colors shrink-0"
                    >
                      {revoking ? <LoaderCircle size={9} className="animate-spin" /> : 'Yes, revoke'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(false)}
                      className="px-2.5 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] text-[9px] font-bold transition-colors shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] border border-[var(--border-color)] transition-colors"
                  >
                    <Trash2 size={11} className="text-rose-400 shrink-0" />
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      Revoke all relay access from the dashboard
                    </span>
                  </button>
                )}

                {revokeError && <p className="text-[9px] text-red-400">{revokeError}</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
