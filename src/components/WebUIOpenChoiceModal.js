'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ExternalLink,
  PictureInPicture2,
  MonitorSmartphone,
  CheckCircle2,
} from 'lucide-react';
import {
  WEBUI_OPEN_MODE_IN_APP,
  WEBUI_OPEN_MODE_EXTERNAL,
} from '@/utils/webuiOpenMode';

/**
 * "How do you want to open the Web UI?" — the fork in front of every open.
 *
 * It exists because the two transports fail in different places, and no single
 * one is right for every device:
 *
 *   • In-app frames the same-origin proxy, so it needs no popup, no relay on
 *     this device and no loopback jump. That is why it is the option that
 *     actually works on a phone in standard (non-desktop) mobile mode.
 *   • An external tab is the better answer on the machine running Local Relay
 *     (0ms direct transfer, real devtools, its own cookie jar) — and it is what
 *     people expect on desktop.
 *
 * Rendered as a bottom sheet on phones and a centred card from `sm:` up, which
 * is the pattern the rest of the app uses for mobile.
 */
export default function WebUIOpenChoiceModal({
  open,
  agentName = 'Web UI',
  port = '',
  isMobile = false,
  relayActive = false,
  onChoose,
  onClose,
}) {
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const choose = (mode) => {
    // Must stay synchronous: the external route claims its tab with
    // window.open(), which only escapes the popup blocker inside a live
    // user gesture. Do not await anything before calling onChoose.
    onChoose?.(mode, remember);
  };

  const externalHint = relayActive && !isMobile
    ? 'New browser tab, streamed straight from your Local Relay — no server hop.'
    : 'New browser tab through the monitor server. Some phone browsers block this.';

  return createPortal(
    <div
      className="fixed inset-0 z-[10020] flex items-end justify-center sm:items-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Choose how to open the Web UI"
      >
        <div className="h-1 w-full bg-gradient-to-r from-sky-500 via-indigo-500 to-sky-500" />

        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <MonitorSmartphone size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-white">Open {agentName} Web UI</h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Choose how it opens{port ? ` on port ${port}` : ''}.
                {isMobile ? ' In-app is recommended on phones and tablets.' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-11 h-11 -m-2 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition"
            >
              <X size={15} />
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <button
              data-webui-open-mode="in-app"
              onClick={() => choose(WEBUI_OPEN_MODE_IN_APP)}
              className="w-full text-left rounded-xl border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-400/60 transition p-3.5 group cursor-pointer min-h-[64px]"
            >
              <div className="flex items-center gap-2">
                <PictureInPicture2 size={15} className="text-sky-300 shrink-0" />
                <span className="text-[13px] font-bold text-white group-hover:text-sky-200">
                  Open in app
                </span>
                {isMobile && (
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30">
                    RECOMMENDED
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-1">
                Opens as a standalone browser app inside monitor. Stays running independently
                when closing AI Agents — works on phones, tablets and desktop.
              </p>
            </button>

            <button
              data-webui-open-mode="external"
              onClick={() => choose(WEBUI_OPEN_MODE_EXTERNAL)}
              className="w-full text-left rounded-xl border border-[var(--border-color)] bg-white/5 hover:bg-white/10 hover:border-indigo-400/40 transition p-3.5 group cursor-pointer min-h-[64px]"
            >
              <div className="flex items-center gap-2">
                <ExternalLink size={15} className="text-indigo-300 shrink-0" />
                <span className="text-[13px] font-bold text-white group-hover:text-indigo-200">
                  Open in browser tab
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-1">
                {externalHint}
              </p>
            </button>
          </div>

          <label className="mt-3 flex items-center gap-2.5 cursor-pointer select-none min-h-[44px]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 accent-sky-500 cursor-pointer"
            />
            <span className="text-[11px] text-[var(--text-muted)]">
              Remember my choice on this device
              {remember && <CheckCircle2 size={11} className="inline ml-1 text-sky-400" />}
            </span>
          </label>

          <button
            onClick={onClose}
            className="w-full mt-2 py-2.5 rounded-xl text-[11px] font-bold text-[var(--text-muted)] hover:text-white border border-[var(--border-color)] hover:border-white/20 transition cursor-pointer min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
