'use client';

import { LoaderCircle, Mail } from 'lucide-react';

/* ── Terminal-style auth rows. Each option is a shell-menu entry:
      [1] ▸ Continue with Google
      [2] ▸ Email & Password Login
   Hover inverts to green-on-dark, like selecting in a TUI. ── */

function Row({ num, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group w-full flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-md font-mono text-xs cursor-pointer text-emerald-100/85 border-l-2 border-transparent transition-all duration-150 hover:bg-emerald-500/15 hover:border-emerald-400 hover:text-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed text-left"
    >
      <span className="text-emerald-500/70 group-hover:text-emerald-300 shrink-0">[{num}]</span>
      {children}
      <span className="ml-auto text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        ▸
      </span>
    </button>
  );
}

/* ── AuthActions — the hero console's auth menu ── */
function AuthActions({
  passkeySupported,
  passkeyLoading,
  passkeyError,
  onPasskey,
  onEmail,
  onDemo,
}) {
  let n = 1;
  return (
    <div>
      <div className="rounded-md border border-emerald-900/40 bg-black/30 divide-y divide-emerald-900/20 overflow-hidden">
        {passkeySupported && (
          <Row num={n++} onClick={onPasskey} disabled={passkeyLoading}>
            {passkeyLoading ? (
              <LoaderCircle size={13} className="animate-spin text-emerald-300" />
            ) : (
              <span className="text-emerald-400">🔑</span>
            )}
            <span>{passkeyLoading ? 'Verifying Passkey…' : 'Sign in with Passkey'}</span>
          </Row>
        )}
        <Row num={n++} onClick={onEmail}>
          <Mail size={13} className="text-emerald-400 shrink-0" />
          <span>Email &amp; Password Login</span>
        </Row>
        {onDemo && (
          <Row num={n++} onClick={onDemo}>
            <span className="text-emerald-400/70">▸</span>
            <span>Continue to Demo Mode</span>
          </Row>
        )}
      </div>
      {passkeyError && (
        <p className="mt-2.5 font-mono text-[10px] text-rose-400/90">✗ {passkeyError}</p>
      )}
    </div>
  );
}

/* ── CloserActions — end-of-story: same menu, compact framing ── */
function CloserActions({
  passkeySupported,
  passkeyLoading,
  passkeyError,
  onPasskey,
  onEmail,
  onDemo,
}) {
  let n = 1;
  return (
    <div>
      <div className="rounded-md border border-emerald-900/40 bg-black/30 divide-y divide-emerald-900/20 overflow-hidden">
        <Row num={n++} onClick={onEmail}>
          <Mail size={13} className="text-emerald-400 shrink-0" />
          <span>Email &amp; Password Login</span>
        </Row>
      </div>
      {passkeyError && (
        <p className="mt-2.5 font-mono text-[10px] text-rose-400/90">✗ {passkeyError}</p>
      )}
      {(passkeySupported || onDemo) && (
        <div className="mt-3 flex items-center gap-2.5 flex-wrap font-mono text-[10px] text-emerald-300/50">
          {passkeySupported && (
            <button
              type="button"
              onClick={onPasskey}
              disabled={passkeyLoading}
              className="hover:text-emerald-200 transition-colors cursor-pointer disabled:opacity-60"
            >
              {passkeyLoading ? 'verifying…' : '▸ passkey'}
            </button>
          )}
          {passkeySupported && onDemo && <span className="text-emerald-900 select-none">·</span>}
          {onDemo && (
            <button
              type="button"
              onClick={onDemo}
              className="hover:text-emerald-200 transition-colors cursor-pointer"
            >
              ▸ demo mode
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { AuthActions, CloserActions };
