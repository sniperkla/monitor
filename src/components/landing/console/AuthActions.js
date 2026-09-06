'use client';

import { signIn } from 'next-auth/react';
import { LoaderCircle, Fingerprint, Mail, ChevronRight } from 'lucide-react';

/* ── Auth actions — shared by the hero console and the closing CTA ── */
function AuthActions({
  passkeySupported,
  passkeyLoading,
  passkeyError,
  onPasskey,
  onEmail,
  onDemo,
  compact = false,
}) {
  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-2.5'}>
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl: '/' })}
        className="relative w-full flex items-center justify-center gap-3 px-5 py-3 min-h-[44px] rounded-lg text-xs font-semibold cursor-pointer bg-white text-slate-900 transition-colors duration-200 hover:bg-slate-200 active:bg-slate-300"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
      >
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
        </span>
        <span className="font-semibold tracking-wide text-slate-800">Continue with Google</span>
      </button>

      {passkeySupported && (
        <>
          <button
            type="button"
            onClick={onPasskey}
            disabled={passkeyLoading}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold cursor-pointer text-slate-300 transition-colors duration-200 bg-slate-900/60 hover:bg-slate-800/70 border border-slate-700/50 disabled:opacity-60"
          >
            {passkeyLoading ? (
              <LoaderCircle size={15} className="text-slate-400 animate-spin" />
            ) : (
              <Fingerprint size={15} className="text-slate-400" />
            )}
            <span>{passkeyLoading ? 'Verifying Passkey…' : 'Sign in with Passkey'}</span>
          </button>
          {passkeyError && (
            <p className="text-[10px] text-red-400/90 text-center -mt-1">{passkeyError}</p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onEmail}
                  className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold cursor-pointer text-slate-200 transition-colors duration-200 bg-slate-900/60 hover:bg-slate-800/70 border border-slate-700/50 hover:border-slate-500/60"
      >
        <Mail size={14} className="text-cyan-400" />
        <span>Email &amp; Password Login</span>
      </button>

      <button
        type="button"
        onClick={onDemo}
        className="w-full flex items-center justify-center gap-1.5 px-5 py-2 min-h-[40px] rounded-lg text-[11px] font-medium cursor-pointer text-slate-400 hover:text-slate-200 transition-colors bg-white/[0.03] hover:bg-white/[0.07] border border-white/5"
      >
        <span>Continue to Demo Mode</span>
        <ChevronRight size={13} className="opacity-60" />
      </button>
    </div>
  );
}


export { AuthActions };
