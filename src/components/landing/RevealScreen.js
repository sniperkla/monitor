/* ═══════════════════════════════════════════════════════════════════════
   RevealScreen — a scrollable landing story on the app's macOS desktop.

   The guest lands on the same desktop environment the app uses: wallpaper,
   menu bar, dock (DesktopChrome). On it floats the sign-in terminal; every
   section below is another command ($ ssh --fleet, $ watch --live, …)
   documenting a real part of the app.

   Resource budget:
   - One scroll-driven IntersectionObserver + one passive capture scroll
     listener (rAF-throttled, DOM writes only, no React state while
     scrolling). Pointer tilt on the card is rAF-throttled pointermove.
   - Reveals, typed lines, bars, sweeps: pure CSS gated by .in-view.
   - No WebGL, no rAF loops on this page.
   ═══════════════════════════════════════════════════════════════════════ */
import { signIn } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import { CinematicAuthModal } from './CinematicAuthModal';
import { signInWithPasskey, passkeysSupported } from '@/utils/passkey';
import { CONSOLE_CSS, SUBTITLE } from './console/theme';
import DesktopChrome from './DesktopChrome';
import { prefersReducedMotion, useIsTouch, useDocumentVisible } from './story/hooks';
import { ScrambleTitle } from './console/ScrambleTitle';
import { AuthActions, CloserActions } from './console/AuthActions';
import { Statusline } from './console/Statusline';
import { useScrollStory } from './story/useScrollStory';
import { SectionHead, FleetMock, MonitorMock, SecurityMock, BackupMock, AgentMock } from './story/mocks';

/* Passkey sign-in is available in-app but not offered on this screen —
   flip to true to restore the "Sign in with Passkey" buttons. */
const SHOW_PASSKEY = false;

/* Demo mode stays wired (onDismiss) but is not offered on this screen —
   flip to true to restore the "Continue to Demo Mode" entry. */
const SHOW_DEMO = false;

/* ── Main Reveal Screen ── */
export function RevealScreen({ onDismiss }) {
  const [reduced] = useState(() => prefersReducedMotion());
  const isTouch = useIsTouch();
  const docVisible = useDocumentVisible();
  const motionOff = reduced || isTouch;

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'register' | 'forgot' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [name, setName] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);

  const [passkeySupported] = useState(() => (typeof window !== 'undefined' ? passkeysSupported() : false));
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState(null);

  const cardRef = useRef(null);
  const heroRef = useRef(null);
  const railRef = useRef(null);
  const storyRailRef = useRef(null);
  const cmdRef = useRef(null);

  /* Pointer tilt on the hero card: CSS variables from a rAF-throttled
     pointermove. No idle loop — work happens only while the pointer moves. */
  useEffect(() => {
    if (motionOff) return undefined;
    const el = cardRef.current;
    if (!el) return undefined;

    let raf = 0;
    let queued = false;
    let px = 0;
    let py = 0;

    const apply = () => {
      queued = false;
      el.style.setProperty('--rx', `${(-py * 1.4).toFixed(3)}deg`);
      el.style.setProperty('--ry', `${(px * 1.8).toFixed(3)}deg`);
      el.style.setProperty('--tx', `${(-px * 7).toFixed(2)}px`);
      el.style.setProperty('--ty', `${(-py * 5).toFixed(2)}px`);
    };
    const onMove = (e) => {
      px = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      py = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      if (!queued) {
        queued = true;
        raf = requestAnimationFrame(apply);
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [motionOff]);

  useScrollStory({ motionOff, heroRef, railRef, storyRailRef, cmdRef });

  const handlePasskeySignIn = async () => {
    setPasskeyError(null);
    setPasskeyLoading(true);
    try {
      await signInWithPasskey({ callbackUrl: '/' });
    } catch (err) {
      setPasskeyError(err.message || 'Passkey sign-in failed.');
      setPasskeyLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    setAuthLoading(true);
    try {
      if (authMode === 'register') {
        if (!email || !password || !confirmPassword) {
          setAuthError('Please fill in all required fields.');
          setAuthLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setAuthError('Passphrases do not match. Please verify your password.');
          setAuthLoading(false);
          return;
        }

        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Registration failed.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Account registered! Verification code sent to your email.');
        setAuthMode('verify');
        setAuthLoading(false);
        return;
      }

      if (authMode === 'verify') {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'confirm',
            email: email.trim().toLowerCase(),
            code: verifyCodeInput,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Email verification failed.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Email verified successfully! You can now sign in.');
        setAuthMode('signin');
        setAuthLoading(false);
        return;
      }

      if (authMode === 'forgot') {
        if (!email) {
          setAuthError('Please enter your email address.');
          setAuthLoading(false);
          return;
        }
        if (!resetCode) {
          const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
          const data = await res.json();
          if (!data.success) {
            setAuthError(data.error || 'Failed to send password reset code.');
            setAuthLoading(false);
            return;
          }
          setAuthSuccess('Password reset code sent to your email. Please enter it below.');
          setAuthLoading(false);
          return;
        }

        if (!newPassword) {
          setAuthError('Please enter your new password.');
          setAuthLoading(false);
          return;
        }
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: resetCode,
            newPassword,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Failed to reset password.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Password reset successfully! You can now sign in.');
        setAuthMode('signin');
        setResetCode('');
        setNewPassword('');
        setAuthLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error) {
        setAuthError(
          result.error === 'CredentialsSignin' ? 'Invalid email or password' : result.error
        );
        setAuthLoading(false);
      } else if (result?.ok) {
        window.location.href = result.url || '/';
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication failed. Please try again.');
      setAuthLoading(false);
    }
  };

  const fieldActive = !showAuthModal && docVisible;
  const authProps = {
    passkeySupported: passkeySupported && SHOW_PASSKEY,
    passkeyLoading,
    passkeyError,
    onPasskey: handlePasskeySignIn,
    onEmail: () => setShowAuthModal(true),
    onDemo: SHOW_DEMO ? onDismiss : null,
  };

  return (
    // Horizontal overflow (tilt, ghosts) is clipped; vertical scrolling
    // belongs to the parent wrapper ([data-scroll-root]).
    <div className="relative w-full overflow-x-hidden bg-black">
      <style>{CONSOLE_CSS}</style>

      {/* macOS desktop: wallpaper, menu bar, dock */}
      <DesktopChrome />

      {/* Session progress rail (right edge) */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 z-[5] hidden md:block h-44 w-px bg-white/10 pointer-events-none">
        <span
          ref={railRef}
          className="block w-px h-full bg-slate-400/70 origin-top"
          style={{ transform: 'scaleY(0)' }}
        />
      </div>

      {/* ═══ Hero — the access console ═══ */}
      <div
        ref={heroRef}
        data-scene="hero"
        className="relative z-10 min-h-[100dvh] flex flex-col items-center will-change-transform"
      >
        <div
          className="m-auto w-full flex flex-col items-center px-4 sm:px-6"
          style={{
            paddingTop: 'calc(3rem + env(safe-area-inset-top))',
            paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
          }}
        >
          <div
            ref={cardRef}
            className="console-card rise relative w-full max-w-md rounded-xl border border-emerald-900/50 overflow-hidden font-mono"
            style={{
              animationDelay: '120ms',
              background: '#020c07',
              boxShadow: '0 24px 70px rgba(0,0,0,0.6), inset 0 1px 0 rgba(110,231,183,0.06)',
            }}
          >
            {/* Title bar */}
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-emerald-900/40 bg-black/40 relative z-[1]">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
              </span>
              <span className="flex-1 text-center font-mono text-[9px] sm:text-[10px] text-emerald-300/50 tracking-wider truncate">
                monitor@orbit — ssh — 80×24
              </span>
              <span className="font-mono text-[9px] text-emerald-800">ssh:22</span>
            </div>

            <div className="relative z-[1] px-5 sm:px-7 pt-5 pb-6 sm:pb-7">
              <div className="rise font-mono text-[11px] text-emerald-300/85" style={{ animationDelay: '260ms' }}>
                <span className="text-emerald-500/70 mr-1.5">$</span>ssh monitor@orbit
              </div>
              <div className="rise mt-1 font-mono text-[11px] text-emerald-200/70" style={{ animationDelay: '340ms' }}>
                ✓ access gateway online
              </div>

              <ScrambleTitle reduced={motionOff} delay={320} />

              <div
                // No letter-spacing on this line: the CSS typewriter sizes
                // itself in `ch` units, which exclude tracking — any
                // letter-spacing here would clip the last few characters
                // behind the overflow mask.
                className="rise mt-2.5 mb-3 flex items-baseline font-mono text-[10px] sm:text-[11px] text-slate-400 min-h-[16px]"
                style={{ animationDelay: '480ms' }}
              >
                <span className="text-emerald-400/80 mr-1.5">&gt;</span>
                <span className="css-type uppercase" style={{ '--n': '32ch', '--tdel': '1.35s' }}>
                  {SUBTITLE}
                </span>
                <span className="caret" style={{ animationDelay: '1.35s' }} />
              </div>


              <div className="rise font-mono text-[9px] uppercase tracking-[0.26em] text-emerald-300/50 mb-2" style={{ animationDelay: '600ms' }}>
                select auth method:
              </div>
              <div className="rise" style={{ animationDelay: '640ms' }}>
                <AuthActions {...authProps} />
              </div>

              <div className="rise mt-5 flex items-center font-mono text-[11px] text-emerald-300/85" style={{ animationDelay: '760ms' }}>
                <span className="text-emerald-500/70 mr-1.5">$</span>
                <span className="caret" style={{ animationDelay: '1.5s' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ The session log — scroll story ═══ */}
      <div className="relative z-10">
        {/* Timeline rail connecting every section (desktop) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[27px] top-0 bottom-0 hidden md:block w-px"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.16) 6%, rgba(34,211,238,0.16) 94%, transparent 100%)',
          }}
        />

        {/* ── 01 · SSH fleet ── */}
        <section data-cmd="$ ssh --fleet" data-scene="fleet" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="ssh --fleet"
            index="01"
            title="Every machine. One glass."
            sub="Open a live terminal to any box in your fleet straight from the browser — SSH sessions, tmux panes, files and logs, no local client required."
          />
          <FleetMock />
        </section>

        {/* ── 02 · Server monitor ── */}
        <section data-cmd="$ watch --live" data-scene="watch" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="watch --live"
            index="02"
            title="Metrics without the noise."
            sub="Server Monitor streams CPU, memory, disk and network next to container health — one calm view that tells you before it breaks."
          />
          <MonitorMock />
        </section>

        {/* ── 03 · Vault & security ── */}
        <section data-cmd="$ vault --audit" data-scene="vault" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="vault --audit"
            index="03"
            title="Locked down by default."
            sub="An encrypted vault for every credential, a firewall blocklist fed by fail2ban, scheduled ClamAV sweeps, and passkey-first sign-in."
          />
          <SecurityMock />
        </section>

        {/* ── 04 · Backups ── */}
        <section data-cmd="$ backup --sync" data-scene="backup" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="backup --sync"
            index="04"
            title="Backups that run themselves."
            sub="Rclone cloud sync, MongoDB snapshots and full server images on a cron — scheduled, verified, one click to restore."
          />
          <BackupMock />
        </section>

        {/* ── 05 · AI agents ── */}
        <section data-cmd="$ agent --spawn" data-scene="agents" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="agent --spawn"
            index="05"
            title="AI agents on watch."
            sub="Spawn Hermes, Nanobot, OpenClaw or ZeroClaw on your servers. Agents watch logs, run repairs and report back while you sleep."
          />
          <AgentMock />
        </section>

        {/* ═══ Closing CTA ═══ */}
        <section data-cmd="$ access --grant" data-scene="grant" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 pt-10 pb-24 sm:pb-28">
          <span className="sweep" aria-hidden="true" />
          <div className="io mx-auto w-full max-w-md rounded-xl border border-slate-700/60 overflow-hidden bg-[#020c07]">
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-700/50 bg-slate-900/60">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
              </span>
              <span className="flex-1 text-center font-mono text-[9px] sm:text-[10px] text-slate-500 tracking-wider">
                monitor@orbit — ~/access
              </span>
              <Activity size={12} className="text-slate-600" />
            </div>
            <div className="px-5 sm:px-7 py-6 sm:py-7">
              <p className="font-mono text-[10px] text-slate-500 mb-2">
                <span className="text-slate-600">$</span> access --grant
              </p>
              <h2 className="font-mono text-xl sm:text-2xl font-bold text-slate-100 tracking-wide">
                Ready when you are.
              </h2>
              <p className="mt-2 mb-6 text-xs sm:text-sm text-slate-400 leading-relaxed">
                Sign in and your terminals, vault and fleet light up. Your first
                server is sixty seconds away.
              </p>
              <CloserActions {...authProps} />
            </div>
          </div>
        </section>

        <footer className="relative pb-14 pt-2 text-center">
          <p className="font-mono text-[9px] tracking-[0.24em] uppercase text-slate-600">
            SSH Monitor — terminal &amp; server control
          </p>
          <p className="mt-1.5 font-mono text-[8px] text-slate-700">
            session closed · [0] exit 0
          </p>
        </footer>
      </div>

      <Statusline cmdRef={cmdRef} />

      {/* ── Cinematic Email & Password Authentication Modal ── */}
      <AnimatePresence>
        {showAuthModal && (
          <CinematicAuthModal
            isOpen={showAuthModal}
            onClose={() => setShowAuthModal(false)}
            authMode={authMode}
            setAuthMode={setAuthMode}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            name={name}
            setName={setName}
            resetCode={resetCode}
            setResetCode={setResetCode}
            verifyCodeInput={verifyCodeInput}
            setVerifyCodeInput={setVerifyCodeInput}
            authLoading={authLoading}
            authError={authError}
            setAuthError={setAuthError}
            authSuccess={authSuccess}
            setAuthSuccess={setAuthSuccess}
            handleAuthSubmit={handleAuthSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

