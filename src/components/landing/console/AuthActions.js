'use client';

import { signIn } from 'next-auth/react';
import { LoaderCircle, Mail } from 'lucide-react';

/* ── Terminal-style auth rows. Each option is a shell-menu entry:
      [1] ▸ Continue with Google
      [2] ▸ Email & Password Login
   Hover inverts to green-on-dark, like selecting in a TUI. ── */

function GoogleGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

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
        <Row num={n++} onClick={() => signIn('google', { callbackUrl: '/' })}>
          <GoogleGlyph />
          <span>Continue with Google</span>
        </Row>
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
        <Row num={n++} onClick={() => signIn('google', { callbackUrl: '/' })}>
          <GoogleGlyph />
          <span>Continue with Google</span>
        </Row>
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
