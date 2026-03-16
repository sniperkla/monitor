'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { useSession } from 'next-auth/react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { i18n } from '@/lib/i18n';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, X, Minus, Maximize2, Wifi,
  Sparkles, Copy, CornerDownLeft, ShieldAlert, Settings2, Clock, RefreshCw,
  ListChecks, Trophy, Search, Languages, Lock, Brain, ChevronDown, ChevronUp,
  AtSign, Folder, File as FileIconAi
} from 'lucide-react';
import { diff_match_patch } from 'diff-match-patch';

let Terminal, FitAddon, WebLinksAddon;

const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== 'string') return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const extractUnifiedDiff = (text) => {
  const t = String(text || '');
  if (!t) return null;

  // We look for common unified diff markers.
  // Supports diff -u, git diff, and some patch outputs.
  const lines = t.split(/\r?\n/);
  const startIdx = lines.findIndex((l) =>
    l.startsWith('diff --git ') ||
    l.startsWith('--- ') ||
    l.startsWith('+++ ') ||
    l.startsWith('@@ ') ||
    l.startsWith('@@@ ')
  );
  if (startIdx === -1) return null;

  const diffLines = lines.slice(startIdx);
  const diffText = diffLines.join('\n').trim();
  if (!/^(diff --git |--- |\+\+\+ |@@ )/m.test(diffText)) return null;

  const fileMap = new Map();
  let currentFile = null;

  const ensureFile = (path) => {
    const p = String(path || '').trim();
    if (!p) return null;
    if (!fileMap.has(p)) {
      fileMap.set(p, { path: p, added: 0, removed: 0, lines: [] });
    }
    return fileMap.get(p);
  };

  for (const l of diffLines) {
    const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      currentFile = m[2];
      ensureFile(currentFile);
    }
    const fileEntry = currentFile ? ensureFile(currentFile) : null;
    if (fileEntry) fileEntry.lines.push(l);

    if (l.startsWith('+++ ') || l.startsWith('--- ')) continue;
    if (l.startsWith('+') && !l.startsWith('+++')) {
      if (fileEntry) fileEntry.added++;
    }
    if (l.startsWith('-') && !l.startsWith('---')) {
      if (fileEntry) fileEntry.removed++;
    }
  }

  const files = Array.from(fileMap.values()).slice(0, 20);
  const added = files.reduce((sum, f) => sum + (f.added || 0), 0);
  const removed = files.reduce((sum, f) => sum + (f.removed || 0), 0);

  return { diffText, files, added, removed };
};

const TERMINAL_PRESETS = {
  modern: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14,
    theme: {
      background: '#0c0c0c',
      foreground: '#e4e4e7',
      cursor: '#6366f1',
      cursorAccent: '#0c0c0c',
      selectionBackground: 'rgba(99, 102, 241, 0.3)',
      selectionForeground: '#ffffff',
      black: '#1a1a2e', red: '#f43f5e', green: '#4ade80', yellow: '#fbbf24',
      blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
      brightBlack: '#64748b', brightRed: '#fb7185', brightGreen: '#86efac',
      brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  retro: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 18,
    fontWeight: 'normal',
    letterSpacing: 0,
    cursorStyle: 'block',
    theme: {
      background: '#050505',
      foreground: '#18e12c',
      cursor: '#18e12c',
      cursorAccent: '#050505',
      selectionBackground: 'rgba(26, 255, 26, 0.2)',
      selectionForeground: '#ffffff',
      black: '#000000', red: '#ff3333', green: '#18e12c', yellow: '#18e12c',
      blue: '#18e12c', magenta: '#18e12c', cyan: '#18e12c', white: '#18e12c',
      brightBlack: '#333333', brightRed: '#ff6666', brightGreen: '#33ff33',
      brightYellow: '#33ff33', brightBlue: '#33ff33', brightMagenta: '#33ff33',
      brightCyan: '#33ff33', brightWhite: '#ffffff',
    }
  },
  matrix: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 16,
    theme: {
      background: '#000000',
      foreground: '#00ff41',
      cursor: '#00ff41',
      selectionBackground: 'rgba(0, 255, 65, 0.15)',
      black: '#000000', red: '#ff0000', green: '#00ff41', yellow: '#ffff00',
      blue: '#0000ff', magenta: '#ff00ff', cyan: '#00ffff', white: '#d1d1d1',
      brightBlack: '#808080', brightRed: '#ff0000', brightGreen: '#00ff41',
      brightYellow: '#ffff00', brightBlue: '#0000ff', brightMagenta: '#ff00ff',
      brightCyan: '#00ffff', brightWhite: '#ffffff',
    }
  }
};

const MAX_AUTO_STEPS = Number.POSITIVE_INFINITY;

// ─── Error recovery rules keyed by detectTerminalError type ───────────────────
const ERROR_RECOVERY_RULES = {
  command_not_found:  `"Command not found" → The command is not installed or not on $PATH. Install it first (\`apt install <pkg>\` / \`yum install <pkg>\` / \`dnf install <pkg>\`) or find it with \`which <cmd>\`.`,
  permission_denied:  `"Permission denied" → Retry with sudo, or run \`chmod +x <file>\`. If sudo is unavailable, verify you are the correct user.`,
  missing_file:       `"No such file or directory" → Wrong path or missing file. Locate it with \`find / -name <file> 2>/dev/null\` or list the directory with \`ls\`.`,
  wrong_type:         `"Is a directory" / "Not a directory" → You used a file operation on a directory or vice versa. Verify the path with \`ls -la\`.`,
  file_exists:        `"File already exists" → Remove the existing file first (\`rm <file>\`) or choose a different destination path.`,
  package_not_found:  `"Package not found" → The package name may differ across distros. Search with \`apt-cache search <pkg>\` or \`dnf search <pkg>\`.`,
  dependency_error:   `"Dependency conflict / Missing dependency" → Run \`apt --fix-broken install\` or \`dnf install --skip-broken\`. Check for conflicting package versions.`,
  repo_error:         `"Repository not found" → The repo URL may be wrong or unavailable. Verify with \`curl -I <repo-url>\` and update the repo config.`,
  docker_error:       `"Docker error" → Check container status with \`docker ps -a\`. Start it if stopped, or inspect logs with \`docker logs <id>\`.`,
  k8s_error:          `"Kubernetes error" → Check pod status with \`kubectl get pods\` and logs with \`kubectl logs <pod>\`.`,
  db_error:           `"Database connection failed" → Verify the service is running (\`systemctl status mysql\` etc.) and credentials are correct.`,
  disk_full:          `"No space left / Disk quota exceeded" → Free space: \`df -h\` to check usage, \`du -sh /*\` to find large dirs. Remove unused files or expand the volume.`,
  memory_error:       `"Out of memory" → Free memory or add swap: \`free -m\` to check; create swap with \`fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile\`.`,
  system_error:       `"Argument list too long" → Use \`xargs\` or a loop to process files in batches instead of a single glob expansion.`,
  connection_refused: `"Connection refused" → The service is not running or the port is wrong. Check with \`ss -tlnp | grep <port>\` and ensure the service is started.`,
  timeout:            `"Connection timed out" → Check network connectivity (\`ping <host>\`) and firewall rules (\`iptables -L\` or \`firewall-cmd --list-all\`).`,
  dns_error:          `"DNS resolution failed" → Inspect /etc/resolv.conf. Try \`nslookup <host>\` or use the IP address directly.`,
  network_error:      `"Network unreachable" → Check interface status with \`ip a\` and routing with \`ip route\`.`,
  service_error:      `"Service failed to start" / "Job for X failed" → MANDATORY: Read the actual error FIRST with \`journalctl -xeu <service>.service -n 50 --no-pager\` or \`systemctl status <service>.service --no-pager\`. NEVER retry \`systemctl restart\` without first reading the logs. Common causes: config syntax error (run \`nginx -t\`, \`apache2ctl configtest\`), missing file/directory, port conflict (\`ss -tlnp\`), wrong user/permission. Fix the ROOT CAUSE shown in the journal, THEN restart.`,
  service_not_found:  `"Service unit not found" → The service may not be installed. Verify with \`systemctl list-units --type=service | grep <name>\`.`,
  service_inactive:   `"Service inactive" → Start with \`systemctl start <service>\` and enable on boot with \`systemctl enable <service>\`.`,
  port_in_use:        `"Port already in use" → Kill the occupying process: \`fuser -k <port>/tcp\` or \`lsof -ti:<port> | xargs kill -9\`. If it recurs, switch to a different host port (e.g. \`docker run -p 3001:3000\`).`,
  auth_error:         `"Authentication failure" → Verify credentials, SSH keys, or tokens. Check for expired passwords or locked accounts.`,
  syntax_error:       `"Syntax/parse error" → The config file or script has a syntax error. Validate it with the tool's built-in check (e.g. \`nginx -t\`, \`bash -n <script>\`).`,
  config_error:       `"Config test failed / Invalid project name" → Review the configuration file for typos or invalid values. Use the tool's built-in validation command.`,
  glibc_mismatch:     `"version GLIBC_X.XX not found" → The pre-built binary is INCOMPATIBLE with this system's libc. NEVER retry the same binary. Must build from source. Steps IN ORDER: (0) ⚠️ SWAP — ALWAYS run this one command unconditionally before anything else (it is idempotent): \`sudo bash -c 'MEM=$(free -m | awk "/^Mem:/{print $2}"); if [ "$MEM" -lt 4000 ]; then [ -f /swapfile ] || { fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress; chmod 600 /swapfile; mkswap /swapfile; }; swapon /swapfile 2>/dev/null; fi; free -m'\` — DO NOT skip even if you think swap already exists. (1) CPU: \`nproc\`; choose -j: 1 core→-j1, 2→-j1, 3→-j2, 4+→-j(N-1). (2) cargo: \`cargo --version\`; if missing: \`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source $HOME/.cargo/env\`. (3) cd into the repo dir. (4) \`cargo build --release -j <N>\`. (5) \`sudo cp target/release/<binary> /usr/local/bin/\`.`,
  npm_error:          `"NPM Executable error / Cannot find package.json" → You are likely in the wrong directory. Run \`ls\` to confirm, then \`npm install\` if node_modules is missing.`,
  generic_error:      `Check the full error message above. Identify the specific reason and fix the root cause before retrying.`,
  fatal_error:        `A fatal error occurred. Read the full output carefully. Do NOT retry blindly — diagnose the root cause first.`,
};

const ERROR_RECOVERY_FOOTER =
  `- RETRY LIMIT: If the SAME error appears 3 times in a row, STOP and set <done>false</done> with a clear explanation. Do NOT keep retrying the same fix.
- WHEN TO EXIT: Exit (set <done>false</done>) if: the error is a permission you cannot fix, required resources don't exist, or the goal is fundamentally impossible given server state.
- WHEN TO RETRY: Retry with a DIFFERENT approach if: wrong path/directory, missing dependency that can be installed, or configuration can be fixed.`;

// ─── Dynamic blocker recovery: auto-handle known terminal blocking states ─────
// Keys match detectInteractivePrompt().kind values.
// The engine automatically sends `action` and waits `waitMs` before re-checking.
const DYNAMIC_BLOCKER_RECOVERY = {
  // "Press ENTER to continue", "Press RETURN", "(press RETURN)", etc.
  press_enter:        { action: '\r',      label: 'Dismiss "press ENTER"',     waitMs: 600  },
  // "Press any key to continue"
  press_any_key:      { action: '\r',      label: 'Dismiss "press any key"',   waitMs: 600  },
  // "Are you sure you want to continue connecting (yes/no)?" — first-time SSH host key
  ssh_host_verify:    { action: 'yes\n',   label: 'Accept SSH host key',       waitMs: 900  },
  // "[Y/n]", "(y/n)", "Do you want to continue?" — package manager / installer confirmations
  confirm_yn:         { action: 'y\n',     label: 'Auto-confirm Y/N',          waitMs: 800  },
  // "File already exists, overwrite?" style prompts
  confirm_overwrite:  { action: 'y\n',     label: 'Auto-confirm overwrite',    waitMs: 800  },
  // sudo password: try empty enter (works on cloud instances with NOPASSWD sudo like EC2/Ubuntu).
  // autoBlockerRef caps this at 3 attempts — if the prompt keeps reappearing, falls through to modal.
  sudo_password:      { action: '\r',      label: 'Try empty sudo password (NOPASSWD)',  waitMs: 700  },
  // selection / text_input: intentionally absent — wrong default would break the workflow
};
// ─────────────────────────────────────────────────────────────────────────────

export default function TerminalView({ connectionId, connectionName, host, color, onClose, connection, isStandalone, initialCommand }) {
  const { state: appState, dispatch, apiFetch } = useApp();
  const { state: osState, setSshAiHistory, setSshAiPrefs } = useOS();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user?.email;
  const { t, i18n } = useTranslation();
  const terminalRef = useRef(null);
  const termInstanceRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);
  const lastOutputAtRef = useRef(0);
  const [status, setStatus] = useState('connecting'); // connecting, connected, error, closed
  const [errorMsg, setErrorMsg] = useState(null);
  const [latency, setLatency] = useState(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [showReconnect, setShowReconnect] = useState(false);
  const idleTimedOutRef = useRef(false);
  const termDbUriRef = useRef(appState.dbConfig?.uri || '');
  const termStatusRef = useRef(status);
  useEffect(() => { termStatusRef.current = status; }, [status]);

  const outputLinesRef = useRef([]);
  const outputBufferRef = useRef('');
  const lastCommandSentAtRef = useRef(0);
  const sawOutputAfterCommandRef = useRef(false);
  const commandRunningRef = useRef(false); // true while executeCommandAndCapture is actively awaiting

  const inputBufferRef = useRef('');
  const recentCommandsRef = useRef([]);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiHasOpenedOnce, setAiHasOpenedOnce] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const aiPromptRef = useRef(null);
  const autoGoalRef = useRef(null);
  const [aiMention, setAiMention] = useState({ active: false, query: '', results: [], selectedIndex: 0, triggerPos: 0, field: 'prompt', dirPath: '' }); // field: 'prompt' | 'goal'
  const aiMentionFilesRef = useRef({ dir: null, files: [] }); // cached file list keyed by directory
  const mentionedFilesRef = useRef([]); // @mentioned absolute paths in current goal (for patch path accuracy)
  const autoSessionBackupIdRef = useRef(null); // single backup ID reused for the whole auto session (prevents .bak spam)
  const [noMentionWarning, setNoMentionWarning] = useState(false);
  
  // ── Mode-Specific AI State Storage ──
  // We use separate state for Manual and Auto modes so their results don't mix.
  const [manualAiLoading, setManualAiLoading] = useState(false);
  const [autoAiLoading, setAutoAiLoading] = useState(false);

  const [manualAiAnswer, setManualAiAnswer] = useState(null);
  const [autoAiAnswer, setAutoAiAnswer] = useState(null);

  const [manualAiError, setManualAiError] = useState(null);
  const [autoAiError, setAutoAiError] = useState(null);

  const [manualAiDone, setManualAiDone] = useState(false);
  const [autoAiDone, setAutoAiDone] = useState(false);

  const [manualAiDoneSummary, setManualAiDoneSummary] = useState(null);
  const [autoAiDoneSummary, setAutoAiDoneSummary] = useState(null);

  const [manualAiStreamText, setManualAiStreamText] = useState('');
  const [autoAiStreamText, setAutoAiStreamText] = useState('');

  const [manualAiStreaming, setManualAiStreaming] = useState(false);
  const [autoAiStreaming, setAutoAiStreaming] = useState(false);

  const [manualAiAnswerCollapsed, setManualAiAnswerCollapsed] = useState(false);
  const [autoAiAnswerCollapsed, setAutoAiAnswerCollapsed] = useState(false);

  const [manualFileChanges, setManualFileChanges] = useState(null);
  const [autoFileChanges, setAutoFileChanges] = useState(null);

  // ── Mode Selection Shims ──
  // These variables dynamically point to the state of the CURRENT mode (aiMode).
  // Note: aiMode is defined further down, so we use a functional approach or move it.
  // We'll move aiMode declaration up to line 247 for stability.
  const [aiMode, setAiMode] = useState('manual'); // manual | auto

  const aiLoading = aiMode === 'manual' ? manualAiLoading : autoAiLoading;
  const setAiLoading = aiMode === 'manual' ? setManualAiLoading : setAutoAiLoading;

  const aiAnswer = aiMode === 'manual' ? manualAiAnswer : autoAiAnswer;
  const setAiAnswer = (val) => aiMode === 'manual' ? setManualAiAnswer(val) : setAutoAiAnswer(val);

  const aiError = aiMode === 'manual' ? manualAiError : autoAiError;
  const setAiError = (val) => aiMode === 'manual' ? setManualAiError(val) : setAutoAiError(val);

  const aiDone = aiMode === 'manual' ? manualAiDone : autoAiDone;
  const setAiDone = (val) => aiMode === 'manual' ? setManualAiDone(val) : setAutoAiDone(val);

  const aiDoneSummary = aiMode === 'manual' ? manualAiDoneSummary : autoAiDoneSummary;
  const setAiDoneSummary = (val) => aiMode === 'manual' ? setManualAiDoneSummary(val) : setAutoAiDoneSummary(val);

  const aiStreamText = aiMode === 'manual' ? manualAiStreamText : autoAiStreamText;
  const setAiStreamText = (val) => aiMode === 'manual' ? setManualAiStreamText(val) : setAutoAiStreamText(val);

  const aiStreaming = aiMode === 'manual' ? manualAiStreaming : autoAiStreaming;
  const setAiStreaming = (val) => aiMode === 'manual' ? setManualAiStreaming(val) : setAutoAiStreaming(val);

  const aiAnswerCollapsed = aiMode === 'manual' ? manualAiAnswerCollapsed : autoAiAnswerCollapsed;
  const setAiAnswerCollapsed = (val) => aiMode === 'manual' ? setManualAiAnswerCollapsed(val) : setAutoAiAnswerCollapsed(val);

  const fileChanges = aiMode === 'manual' ? manualFileChanges : autoFileChanges;
  const setFileChanges = (val) => aiMode === 'manual' ? setManualFileChanges(val) : setAutoFileChanges(val);

  const [manualChatHistory, setManualChatHistory] = useState([]);
  const [autoChatHistory, setAutoChatHistory] = useState([]);
  const chatHistory = aiMode === 'manual' ? manualChatHistory : autoChatHistory;
  const setChatHistory = (val) => aiMode === 'manual' ? setManualChatHistory(val) : setAutoChatHistory(val);

  const [sshMemory, setSshMemory] = useState(null);
  const [aiLimitHit, setAiLimitHit] = useState(false);
  const [aiLimitGoal, setAiLimitGoal] = useState(''); // save goal for resume
  const [autoStepHistory, setAutoStepHistory] = useState([]); // track steps for UI
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false);
  const [sensitiveConfirmOpen, setSensitiveConfirmOpen] = useState(false);
  const [pendingSensitiveCommand, setPendingSensitiveCommand] = useState(null);
  const [patchModalOpen, setPatchModalOpen] = useState(false);
  const [patchModalDiff, setPatchModalDiff] = useState('');
  const [lastPatchBackup, setLastPatchBackup] = useState(null); // { id: string, files: string[] } | null
  const [lastPatchResultData, setLastPatchResultData] = useState(null);
  const lastAutoAppliedDiffRef = useRef('');
  const [patchModalAutoApplied, setPatchModalAutoApplied] = useState(false);
  const [patchFileCollapsed, setPatchFileCollapsed] = useState({}); // per-file collapse in patch modal
  const [aiPanelPos, setAiPanelPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 450 : 16, y: 64 });
  const [aiPanelSize, setAiPanelSize] = useState({ width: 420, height: 520 });
  const [aiPanelDocked, setAiPanelDocked] = useState(false);
  const [aiPanelMinimized, setAiPanelMinimized] = useState(false);
  const [interactivePrompt, setInteractivePrompt] = useState(null);
  const manualAiConversationRef = useRef([]);
  const autoAiConversationRef = useRef([]);
  const aiConversationRef = {
    get current() { return aiMode === 'manual' ? manualAiConversationRef.current : autoAiConversationRef.current; },
    set current(val) { 
      if (aiMode === 'manual') manualAiConversationRef.current = val;
      else autoAiConversationRef.current = val;
    }
  };

  const [bgTaskLogs, setBgTaskLogs] = useState([]);
  const [bgTaskStatus, setBgTaskStatus] = useState(null); // { active: bool, logFile: string }
  const [showBgMonitor, setShowBgMonitor] = useState(false);
  const bgPollTimerRef = useRef(null);

  const [lastExecutedCommand, setLastExecutedCommand] = useState('');
  const [lastResultSnapshot, setLastResultSnapshot] = useState('');
  const [lastResultAt, setLastResultAt] = useState(null);
  const [lastResultCollapsed, setLastResultCollapsed] = useState(true); // Default collapsed for cleaner UI
  const [fileChangesCollapsed, setFileChangesCollapsed] = useState(true);
  const [selectedDiffFile, setSelectedDiffFile] = useState('');
  const [skillsSearchResults, setSkillsSearchResults] = useState(null);
  const [skillsSearchLoading, setSkillsSearchLoading] = useState(false);
  const [injectedSkills, setInjectedSkills] = useState(null); // { skills: [...], allAvailable: [...] } shown during engine start
  const [activeSkills, setActiveSkills] = useState([]); // Persistent list of skills currently loaded in context
  const [showSkillsList, setShowSkillsList] = useState(false); // Toggle for skills panel

  const [autoMode, setAutoMode] = useState(false);
  const [autoStepsRemaining, setAutoStepsRemaining] = useState(MAX_AUTO_STEPS);
  const apiRetryCountRef = useRef(0);
  const [autoGoal, setAutoGoal] = useState('');
  const [autoCountdown, setAutoCountdown] = useState(0);
  const aiPanelContentRef = useRef(null);
  const aiDoneRef = useRef(null);
  const autoRunningRef = useRef(false);
  const autoSeenRef = useRef(new Set());
  const autoVerifyKeyRef = useRef('');
  const autoLastLoopKeyRef = useRef('');
  const autoLoopRepeatRef = useRef(0);
  const autoRepeatSigRef = useRef({ key: '', count: 0 });
  const autoSameCommandRef = useRef({ cmd: '', count: 0 });
  const autoRecentCommandsRef = useRef([]);
  const autoRecentSigsRef = useRef([]);
  const autoDiagKeyRef = useRef('');
  const skillInjectionAttemptsRef = useRef(0); // Track skill injection attempts (0=none, 1=local, 2=skillsmp)
  const [lastAiUpdate, setLastAiUpdate] = useState(0);
  const autoTimerRef = useRef(null);
  const autoEmptyRetryRef = useRef('');
  const preloadedSkillsRef = useRef(null); // skills fetched before the first auto-step

  // ─── DYNAMIC ADAPTIVE WAIT SYSTEM ───────────────────────────────────────────
  // Fully dynamic - no hardcoded delays, all calculated from terminal state
  const adaptiveWaitRef = useRef({
    consecutiveBusy: 0,       // How many times terminal was still busy
    lastActivityAt: 0,        // Last time we saw output activity
    lastPromptAt: 0,          // Last time we saw a shell prompt
    totalCommands: 0,         // Total commands run this session
    avgCommandTime: 0,        // Average command execution time
    recentWaits: [],          // Recent wait durations for learning
  });

  // Calculate dynamic wait time based purely on terminal state and history
  const calculateDynamicWait = (isHeavy = false, hasCompilation = false, isApiRetry = false) => {
    const state = adaptiveWaitRef.current;
    const now = Date.now();
    const idleTime = now - (lastOutputAtRef.current || now);
    const timeSinceCommand = now - (lastCommandSentAtRef.current || now);
    const timeSincePrompt = now - (state.lastPromptAt || now);
    
    // Calculate base wait from recent history (adaptive learning)
    const recentWaits = state.recentWaits || [];
    const avgRecentWait = recentWaits.length > 0 
      ? recentWaits.reduce((a, b) => a + b, 0) / recentWaits.length 
      : 1;
    
    // Minimum wait is based on idle time - if terminal is active, check frequently
    const minWait = idleTime < 500 ? 0.5 : 1;
    
    // Calculate progression based on consecutive busy checks
    // Uses exponential backoff with decay based on history
    const busyMultiplier = Math.pow(1.5, state.consecutiveBusy);
    
    // Dynamic max based on command history and average execution time
    const dynamicMax = state.avgCommandTime > 0 
      ? Math.min(state.avgCommandTime * 2, 10)  // Cap at 2x average or 10s
      : 5;  // Default max if no history

    // API retries - scale with consecutive failures
    if (isApiRetry) {
      const apiWait = minWait + (state.consecutiveBusy * avgRecentWait * 0.5);
      return Math.min(apiWait, dynamicMax);
    }

    // Compilation/build - use average recent wait as baseline
    if (hasCompilation) {
      const compWait = avgRecentWait + (state.consecutiveBusy * 0.3);
      return Math.min(compWait, dynamicMax * 0.6);
    }

    // Heavy commands - scale with command complexity
    if (isHeavy) {
      const heavyWait = avgRecentWait * busyMultiplier;
      return Math.min(heavyWait, dynamicMax * 0.75);
    }

    // Standard commands - fully adaptive
    // If we've seen a prompt recently, terminal is responsive - check faster
    if (timeSincePrompt < 5000) {
      return Math.max(minWait, avgRecentWait * 0.5);
    }
    
    // If idle but no prompt, progressive backoff
    const standardWait = minWait + (state.consecutiveBusy * avgRecentWait * 0.2);
    return Math.min(standardWait, dynamicMax);
  };

  // Record a wait for learning
  const recordWait = (duration) => {
    const state = adaptiveWaitRef.current;
    state.recentWaits = [...(state.recentWaits || []), duration].slice(-10); // Keep last 10
  };

  // Increment busy counter when terminal is still running
  const markTerminalBusy = () => {
    adaptiveWaitRef.current.consecutiveBusy++;
  };

  // Reset wait state when command completes or activity detected
  const resetAdaptiveWait = () => {
    const state = adaptiveWaitRef.current;
    state.consecutiveBusy = 0;
    state.lastPromptAt = Date.now();
    state.totalCommands++;
    
    // Update average command time from last command
    if (lastCommandSentAtRef.current && lastOutputAtRef.current) {
      const cmdTime = (Date.now() - lastCommandSentAtRef.current) / 1000;
      state.avgCommandTime = state.avgCommandTime > 0 
        ? (state.avgCommandTime + cmdTime) / 2 
        : cmdTime;
    }
  };
  const containerRef = useRef(null);
  const autoModeRef = useRef(false);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  const suppressInteractiveUntilRef = useRef(0); // epoch ms: ignore interactive prompts until this time
  const detectedOsRef = useRef(null); // persistent OS detection across steps
  const lastGoalRef = useRef(''); // detect goal changes to reset context
  const aiModeRef = useRef('manual');
  useEffect(() => { aiModeRef.current = aiMode; }, [aiMode]);
  const bypassPasswordPauseRef = useRef(false); // skip predictive password-pause for one step after user resumes
  const skillsJustInjectedRef = useRef(false); // force full reset on next resume after skill injection
  // Stores the reason for an engine pause + the pending command so Resume can inject meaningful context
  const pauseReasonRef = useRef({ reason: null, pendingCommand: null }); // reason: 'sudo_password' | 'dangerous' | etc.
  // Tracks consecutive auto-unblock attempts for the same blocker kind.
  // Resets when the kind changes or the blocker is cleared.
  // After 3 failed attempts the engine falls through to the AI / stops gracefully.
  const autoBlockerRef = useRef({ kind: null, count: 0 });

  // Auto-scroll exactly to Mission Accomplished summary when it appears
  useEffect(() => {
    if (aiDone && aiDoneSummary) {
      setTimeout(() => {
        if (aiDoneRef.current) {
          aiDoneRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      }, 400); // Slightly more delay to ensure it's rendered & animation started
    }
  }, [aiDone, aiDoneSummary]);

  const [autoTranslate, setAutoTranslate] = useState(false);
  const [aiTranslations, setAiTranslations] = useState({ explain: '', warn: '', plan: '', thought: '' });
  const [translatingAiText, setTranslatingAiText] = useState({ explain: false, warn: false, plan: false, thought: false });
  const [tmuxInitialized, setTmuxInitialized] = useState(false);
  
  const sshAiPrefs = osState?.sshAiPrefs || { preferSudo: true, aiModel: 'auto' };
  
  // Reset tmux init flag when setting is toggled OFF
  useEffect(() => {
    if (!sshAiPrefs?.autoTmux) {
      setTmuxInitialized(false);
    }
  }, [sshAiPrefs?.autoTmux]);

  // @mention helpers for AI prompt textareas

  // Extracts absolute file paths from @mention tokens in a text string
  const extractMentionedPaths = (text) => {
    const matches = [...String(text || '').matchAll(/@([\S]+)/g)];
    return matches.map(m => m[1].replace(/\/$/, '')).filter(p => p && p.includes('/'));
  };

  const insertAiMention = (file) => {
    const isGoal = aiMention.field === 'goal';
    const currentVal = isGoal ? autoGoal : aiPrompt;
    const dirPath = aiMention.dirPath || '';
    const isDir = file.longname?.startsWith('d');
    // Full path = directory prefix + filename (+ trailing slash for dirs to allow drilling in)
    const fullPath = dirPath + file.filename + (isDir ? '/' : '');
    const before = currentVal.slice(0, aiMention.triggerPos);
    const after = currentVal.slice(aiMention.triggerPos + 1 + aiMention.query.length);

    if (isDir) {
      // For directories: insert path WITHOUT trailing space and keep detecting
      // so the user can immediately see contents of that folder
      const newVal = `${before}@${fullPath}${after}`;
      const newPos = aiMention.triggerPos + 1 + fullPath.length;
      // Clear cache so the next detection fetches this subdir
      aiMentionFilesRef.current = { dir: null, files: [] };
      if (isGoal) {
        setAutoGoal(newVal);
        setTimeout(() => {
          if (autoGoalRef.current) {
            autoGoalRef.current.focus();
            autoGoalRef.current.setSelectionRange(newPos, newPos);
            handleAiMentionDetect(newVal, newPos, 'goal');
          }
        }, 0);
      } else {
        setAiPrompt(newVal);
        setTimeout(() => {
          if (aiPromptRef.current) {
            aiPromptRef.current.focus();
            aiPromptRef.current.setSelectionRange(newPos, newPos);
            handleAiMentionDetect(newVal, newPos, 'prompt');
          }
        }, 0);
      }
    } else {
      // For files: insert with trailing space and close dropdown
      const insertion = `@${fullPath} `;
      const newVal = `${before}${insertion}${after}`;
      const newPos = aiMention.triggerPos + insertion.length;
      aiMentionFilesRef.current = { dir: null, files: [] };
      setAiMention(prev => ({ ...prev, active: false }));
      if (isGoal) {
        setAutoGoal(newVal);
        setTimeout(() => {
          if (autoGoalRef.current) {
            autoGoalRef.current.focus();
            autoGoalRef.current.setSelectionRange(newPos, newPos);
            autoGoalRef.current.style.height = 'auto';
            autoGoalRef.current.style.height = Math.min(autoGoalRef.current.scrollHeight, 96) + 'px';
          }
        }, 0);
      } else {
        setAiPrompt(newVal);
        setTimeout(() => {
          if (aiPromptRef.current) {
            aiPromptRef.current.focus();
            aiPromptRef.current.setSelectionRange(newPos, newPos);
            aiPromptRef.current.style.height = 'auto';
            aiPromptRef.current.style.height = Math.min(aiPromptRef.current.scrollHeight, 120) + 'px';
          }
        }, 0);
      }
    }
  };

  const handleAiMentionDetect = (val, pos, field) => {
    const textBefore = val.slice(0, pos);
    const lastAt = textBefore.lastIndexOf('@');
    if (lastAt !== -1) {
      const segment = textBefore.slice(lastAt + 1);
      if (!segment.includes(' ') && !segment.includes('\n') && segment.length <= 120) {
        // Split segment into directory prefix and file query
        // e.g. ".zeroclaw/draw" → dirPath=".zeroclaw/", fileQuery="draw"
        const lastSlash = segment.lastIndexOf('/');
        const dirPath = lastSlash !== -1 ? segment.slice(0, lastSlash + 1) : '';
        const fileQuery = lastSlash !== -1 ? segment.slice(lastSlash + 1) : segment;
        const listPath = dirPath || '.';

        // Use cache if it belongs to the same directory
        const cache = aiMentionFilesRef.current;
        if (cache.dir === listPath && cache.files.length > 0) {
          const results = cache.files
            .filter(f => !fileQuery || f.filename.toLowerCase().includes(fileQuery.toLowerCase()))
            .slice(0, 12);
          setAiMention({ active: true, query: segment, results, selectedIndex: 0, triggerPos: lastAt, field, dirPath });
          return true;
        }

        // Different directory or empty cache — fetch via SFTP
        const sock = socketRef.current;
        if (sock?.connected) {
          const onList = ({ files }) => {
            if (!files) return;
            const allFiles = files.filter(f => f.filename !== '.' && f.filename !== '..');
            // Cache keyed by directory
            aiMentionFilesRef.current = { dir: listPath, files: allFiles };
            const results = allFiles
              .filter(f => !fileQuery || f.filename.toLowerCase().includes(fileQuery.toLowerCase()))
              .slice(0, 12);
            setAiMention({ active: true, query: segment, results, selectedIndex: 0, triggerPos: lastAt, field, dirPath });
          };
          // ⚠️ Register listener FIRST, then emit — prevents race condition
          sock.once('sftp:list', onList);
          sock.emit('sftp:list', listPath);
          setTimeout(() => sock.off('sftp:list', onList), 5000);
        }
        return true;
      }
    }
    // @ removed or space typed — close dropdown and reset cache
    aiMentionFilesRef.current = { dir: null, files: [] };
    setAiMention(prev => ({ ...prev, active: false }));
    return false;
  };

  const handleAiMentionKeyDown = (e) => {
    if (!aiMention.active || aiMention.results.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAiMention(prev => ({ ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, prev.results.length - 1) }));
      return true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAiMention(prev => ({ ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) }));
      return true;
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertAiMention(aiMention.results[aiMention.selectedIndex]);
      return true;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAiMention(prev => ({ ...prev, active: false }));
      return true;
    }
    return false;
  };

  // Auto Tmux Init
  useEffect(() => {
    if (sshAiPrefs?.autoTmux && status === 'connected' && !tmuxInitialized) {
      setTmuxInitialized(true);
      if (socketRef.current) {
        // Delay slightly to ensure shell is ready for input
        setTimeout(() => {
          if (socketRef.current?.connected && sshAiPrefs?.autoTmux) {
            // Install tmux if missing, then attach the terminal to a persistent tmux session.
            const esc = '\x1b';
            const tmuxCmd = [
              `if [ -z "$TMUX" ]; then`, 
              `  if ! command -v tmux &> /dev/null; then`,
              `    echo "${esc}[1;36m✨ [AI Auto-Setup]${esc}[0m Installing tmux...";`,
              `    if command -v apt-get &> /dev/null; then sudo apt-get install -y tmux -q;`,
              `    elif command -v yum &> /dev/null; then sudo yum install -y tmux -q;`,
              `    elif command -v dnf &> /dev/null; then sudo dnf install -y tmux -q;`,
              `    elif command -v apk &> /dev/null; then sudo apk add tmux -q;`,
              `    elif command -v pacman &> /dev/null; then sudo pacman -S --noconfirm tmux -q;`,
              `    fi;`,
              `  fi;`,
              `  if command -v tmux &> /dev/null; then`,
              `    echo "${esc}[1;36m✨ [AI Auto-Setup]${esc}[0m Attaching to main session...";`,
              `    tmux new-session -d -s ai-bg-task 2>/dev/null || true;`,
              `    exec tmux new-session -A -s main;`,
              `  fi;`,
              `fi;`,
            ].join(' ');
            socketRef.current.emit('ssh:input', tmuxCmd + '\n');
          }
        }, 600);
      }
    }
  }, [sshAiPrefs?.autoTmux, status, tmuxInitialized]);

  // Handle translation when AI answer updates and autoTranslate is enabled
  useEffect(() => {
    if (autoTranslate && aiAnswer) {
      const targetLang = i18n.language;
      if (targetLang === 'en') return;

      const translateField = async (text, key) => {
        if (!text || aiTranslations[key]) return;
        setTranslatingAiText(prev => ({ ...prev, [key]: true }));
        try {
          const res = await fetch('/api/utils/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, targetLang })
          });
          const data = await res.json();
          if (data.success && data.translated) {
            setAiTranslations(prev => ({ ...prev, [key]: data.translated }));
          }
        } catch (err) {
          console.error('Translation error:', err);
        } finally {
          setTranslatingAiText(prev => ({ ...prev, [key]: false }));
        }
      };

      if (aiAnswer.explain && !aiTranslations.explain && !translatingAiText.explain) {
        translateField(aiAnswer.explain, 'explain');
      }
      if (aiAnswer.warn && !aiTranslations.warn && !translatingAiText.warn) {
        translateField(aiAnswer.warn, 'warn');
      }
      if (aiAnswer.plan && !aiTranslations.plan && !translatingAiText.plan) {
        translateField(aiAnswer.plan, 'plan');
      }
      if (aiAnswer.thought && !aiTranslations.thought && !translatingAiText.thought) {
        translateField(aiAnswer.thought, 'thought');
      }
    }
  }, [aiAnswer, autoTranslate, i18n.language]);

  // Clear translations when AI answer is completely cleared or replaced with a new thought
  useEffect(() => {
    if (!aiAnswer) {
      setAiTranslations({ explain: '', warn: '', plan: '', thought: '' });
      setTranslatingAiText({ explain: false, warn: false, plan: false, thought: false });
    }
  }, [aiAnswer]);

  // ── FETCH AI SSH MEMORY ──
  useEffect(() => {
    if (aiOpen && host && session?.user && !sshMemory) {
      apiFetch(`/api/ssh/memory?host=${encodeURIComponent(host)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.memory) {
            setSshMemory(data.memory);
          }
        })
        .catch(err => console.error('Failed to load SSH Memory:', err));
    }
  }, [aiOpen, host, session?.user, sshMemory]);

  // Ensure the panel fits gracefully on mount/resize
  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return;

    const performFit = () => {
      try {
        fitAddonRef.current.fit();
      } catch (e) {
        console.warn('FitAddon.fit() failed:', e);
      }
    };

    // Initial fit
    performFit();

    // Debounced fit on resize
    const resizeObserver = new ResizeObserver(() => {
      performFit();
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Refresh terminal when switching back to the terminal view tab
  // (fixes garbled / corrupted text after the container was hidden)
  useEffect(() => {
    const handleViewActivated = () => {
      if (!fitAddonRef.current || !termInstanceRef.current) return;
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current.fit();
          termInstanceRef.current.refresh(0, termInstanceRef.current.rows - 1);
        } catch (e) {}
      });
    };
    window.addEventListener('terminal:view-activated', handleViewActivated);
    return () => window.removeEventListener('terminal:view-activated', handleViewActivated);
  }, []);

  // Resize observer to scale AI panel position
  useEffect(() => {
    if (!containerRef.current) return;
    let prevWidth = 0;
    let prevHeight = 0;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      
      const { width, height } = entry.contentRect;
      
      if (prevWidth > 0 && prevHeight > 0) {
        const scaleX = width / prevWidth;
        const scaleY = height / prevHeight;
        
        if (Math.abs(width - prevWidth) > 1 || Math.abs(height - prevHeight) > 1) {
          setAiPanelPos(prev => ({
            x: prev.x * scaleX,
            y: prev.y * scaleY
          }));
        }
      }
      prevWidth = width;
      prevHeight = height;
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);


  const sshAiHistory = Array.isArray(osState?.sshAiHistory) ? osState.sshAiHistory : [];
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  // Refs for props that might change but shouldn't trigger a full restart
  const propsRef = useRef({ connectionId, connectionName, host, connection });
  useEffect(() => {
    propsRef.current = { connectionId, connectionName, host, connection };
  }, [connectionId, connectionName, host, connection]);

  const updateConnectionStatus = useCallback((newStatus) => {
    dispatch({
      type: 'UPDATE_CONNECTION',
      payload: {
        _id: connectionId,
        status: newStatus,
        lastConnected: newStatus === 'online' ? new Date().toISOString() : undefined,
      },
    });
  }, [dispatch, connectionId]);

  const initTerminal = useCallback(async () => {
    // Dynamic imports for xterm (client-side only)
    if (!Terminal) {
      const xtermModule = await import('@xterm/xterm');
      const fitModule = await import('@xterm/addon-fit');
      const webLinksModule = await import('@xterm/addon-web-links');
      Terminal = xtermModule.Terminal;
      FitAddon = fitModule.FitAddon;
      WebLinksAddon = webLinksModule.WebLinksAddon;
      await import('@xterm/xterm/css/xterm.css');
    }

    if (!terminalRef.current || termInstanceRef.current) return;

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    fitAddonRef.current = fitAddon;

    const settings = osState?.terminalSettings || {};
    const preset = TERMINAL_PRESETS[settings.activePreset || 'modern'] || TERMINAL_PRESETS.modern;
    const isRetro = settings.activePreset === 'retro';
    const bgOpacity = settings.backgroundOpacity ?? 1;
    const baseBg = settings.theme?.background || preset.theme?.background || '#0c0c0c';

    const term = new Terminal({
      cursorBlink: settings.cursorBlink !== undefined ? settings.cursorBlink : true,
      cursorStyle: settings.cursorStyle || preset.cursorStyle || 'bar',
      fontSize: settings.fontSize || preset.fontSize || 14,
      fontFamily: settings.fontFamily || preset.fontFamily || "'JetBrains Mono', monospace",
      fontWeight: settings.fontWeight || preset.fontWeight || 'normal',
      letterSpacing: settings.letterSpacing || preset.letterSpacing || 0,
      theme: {
        ...(preset.theme || {}),
        ...(settings.theme || {}),
        background: hexToRgba(baseBg, bgOpacity)
      },
      allowTransparency: true,
      scrollback: 5000,
      tabStopWidth: 4,
    });

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    // Initial fit attempt IMMEDIATELY, before socket connect,
    // to guarantee the backend PTY gets the exact client size on shell boot!
    // This prevents bash/nano from missing SIGWINCH if resized right after boot.
    try { 
      // Need a tiny non-blocking tick to let DOM paint the terminal div if it was just unhidden
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch(e) {}
      });
      // But also try synchronously for instant dimension mapping
      fitAddon.fit(); 
    } catch (e) {}

    termInstanceRef.current = term;

    const stripAnsi = (s) => String(s || '')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      // Treat carriage return as a line boundary for our log buffer.
      // This prevents progress bars (dnf/npm) from corrupting prompt detection.
      .replace(/\r/g, '\n');

    const appendOutput = (chunk) => {
      const clean = stripAnsi(chunk);
      if (!clean) return;
      outputBufferRef.current += clean;
      const parts = outputBufferRef.current.split('\n');
      outputBufferRef.current = parts.pop() || '';
      if (parts.length) {
        outputLinesRef.current = outputLinesRef.current.concat(parts);
        if (outputLinesRef.current.length > 40) {
          outputLinesRef.current = outputLinesRef.current.slice(-40);
        }
      }
    };

    term.writeln('\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m');
    term.writeln(`\x1b[1;36m║\x1b[0m  \x1b[1;37m${t('terminal.connectingTo')} \x1b[1;33m${propsRef.current.connectionName}\x1b[0m`);
    term.writeln(`\x1b[1;36m║\x1b[0m  \x1b[90m${propsRef.current.host}\x1b[0m`);
    term.writeln('\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m');
    term.writeln('');

    const socket = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      query: {
        dbUri: termDbUriRef.current
      }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('ssh:connect', { 
        connectionId: propsRef.current.connectionId, 
        connection: propsRef.current.connection,
        cols: term.cols,
        rows: term.rows
      });
    });

    socket.on('heartbeat:pong', (sentTimestamp) => {
      const now = Date.now();
      setLatency(now - sentTimestamp);
    });

    socket.on('ssh:connected', () => {
      setStatus('connected');
      updateConnectionStatus('online'); // Update global state
      idleTimedOutRef.current = false;
      setShowReconnect(false);
      term.writeln(`\x1b[1;32m✓ ${t('terminal.connectedSuccess')}\x1b[0m\n`);
      appendOutput(`✓ ${t('terminal.connectedSuccess')}\n`);
      term.writeln('\r');
      
      // Secondary dimension sync to ensure precision after handshake
      setTimeout(() => {
        try {
          fitAddon.fit();
          if (socket.connected) {
             socket.emit('ssh:resize', { cols: term.cols, rows: term.rows });
          }
        } catch (e) {}
      }, 100);

      // Run initialCommand (e.g. tmux attach) once shell is ready
      if (initialCommand) {
        setTimeout(() => {
          if (socket.connected) {
            socket.emit('ssh:input', initialCommand);
          }
        }, 800);
      }

      term.focus(); // Focus terminal on connect
    });

    socket.on('ssh:data', (data) => {
      term.write(data);
      appendOutput(data);
      lastOutputAtRef.current = Date.now();
      if (lastCommandSentAtRef.current > 0) {
        sawOutputAfterCommandRef.current = true;
      }
    });

    const resetAiOnDisconnect = () => {
      setAutoMode(false);
      setAutoStepsRemaining(0);
      setExecuteConfirmOpen(false);
      setAiError(null);
      setAiAnswer(null);
      setAiDone(false);
      setAiDoneSummary(null);
      setInteractivePrompt(null);
      setPatchModalOpen(false);
      setPatchModalDiff('');
      setPatchModalAutoApplied(false);
      setLastPatchBackup(null);
      setTmuxInitialized(false);
      // Close AI panel and related panels when SSH disconnects
      setAiOpen(false);
      setAiSettingsOpen(false);
      setAiHistoryOpen(false);
      autoRunningRef.current = false;
      lastCommandSentAtRef.current = 0;
      sawOutputAfterCommandRef.current = false;
    };

    socket.on('ssh:error', (data) => {
      if (data.message === 'vault_not_ready') {
        // Don't show as a hard error — vault unlock will trigger auto-reconnect
        setStatus('error');
        setErrorMsg('vault_not_ready');
        resetAiOnDisconnect();
        term.writeln(`\n\x1b[1;33m⚠ Waiting for vault to unlock...\x1b[0m`);
        return;
      }
      setStatus('error');
      setErrorMsg(data.message);
      idleTimedOutRef.current = false;
      setShowReconnect(false);
      resetAiOnDisconnect();
      // updateConnectionStatus('offline'); // Optional, or keep as error
      term.writeln(`\n\x1b[1;31m✗ ${t('terminal.errorPrefix')} ${data.message}\x1b[0m`);
      appendOutput(`\n✗ ${t('terminal.errorPrefix')} ${data.message}\n`);
    });

    socket.on('ssh:closed', () => {
      setStatus('closed');
      updateConnectionStatus('offline'); // Update global state
      idleTimedOutRef.current = false;
      setShowReconnect(false);
      resetAiOnDisconnect();
      term.writeln(`\n\x1b[1;33m⚠ ${t('terminal.connectionClosed')}\x1b[0m`);
      appendOutput(`\n⚠ ${t('terminal.connectionClosed')}\n`);
    });

    // --- Background Task Monitoring Logic ---
    const monitorBgTasks = async () => {
      if (status !== 'connected' || !sshAiPrefs?.autoTmux || !socketRef.current?.connected) return;

      try {
        const checkCmd = "tmux has-session -t ai-bg-task 2>/dev/null && echo 'ACTIVE' || echo 'INACTIVE'";
        const res = await apiFetch(`/api/ssh/execute?connectionId=${connectionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: checkCmd }),
        });
        const data = await res.json();
        const isActive = String(data.output || '').includes('ACTIVE');

        if (isActive) {
          const logFile = "/tmp/ai-bg-task.log";
          const tailCmd = `[ -f ${logFile} ] && tail -n 5 ${logFile} || echo "(Awaiting log output...)"`;
          const logRes = await apiFetch(`/api/ssh/execute?connectionId=${connectionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: tailCmd }),
          });
          const logData = await logRes.json();
          const lines = String(logData.output || '').split('\n').filter(Boolean);
          
          setBgTaskLogs(lines);
          setBgTaskStatus({ active: true, logFile });
        } else {
          setBgTaskStatus(null);
          setBgTaskLogs([]);
        }
      } catch (e) {
        console.warn('[Monitor] Background task polling failed:', e);
      }
    };

    if (bgPollTimerRef.current) clearInterval(bgPollTimerRef.current);
    if (status === 'connected') {
      // Dynamic polling interval based on adaptive wait system
      const bgPollInterval = Math.max((adaptiveWaitRef.current?.avgCommandTime || 2) * 1000, 2000);
      bgPollTimerRef.current = setInterval(monitorBgTasks, bgPollInterval);
    }

    socket.on('ssh:idle_timeout', () => {
      setStatus('closed');
      updateConnectionStatus('offline');
      idleTimedOutRef.current = true;
      setShowReconnect(true);
      resetAiOnDisconnect();
      term.writeln(`\n\x1b[1;33m⚠ ${t('terminal.connectionClosed')} (Idle timeout: 2m)\x1b[0m`);
      appendOutput(`\n⚠ ${t('terminal.connectionClosed')} (Idle timeout: 2m)\n`);
    });

    socket.on('disconnect', () => {
      if (status !== 'closed') {
        setStatus('closed');
        updateConnectionStatus('offline');
        if (!idleTimedOutRef.current) setShowReconnect(false);
        resetAiOnDisconnect();
        term.writeln(`\n\x1b[1;31m✗ ${t('terminal.socketDisconnected')}\x1b[0m`);
        appendOutput(`\n✗ ${t('terminal.socketDisconnected')}\n`);
      }
    });

    term.onData((data) => {
      if (socket.connected && !autoModeRef.current) {
        socket.emit('ssh:input', data);
      }

      // Capture user commands (best-effort) for AI context
      // xterm sends \r on Enter; also handle \n.
      const chunk = String(data || '');
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          const line = inputBufferRef.current;
          inputBufferRef.current = '';
          const cleaned = String(line || '').trim();
          if (cleaned) {
            recentCommandsRef.current = [...recentCommandsRef.current, cleaned].slice(-25);
          }
        } else if (ch === '\u007f') {
          // backspace
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        } else if (ch >= ' ') {
          inputBufferRef.current += ch;
        }
      }
    });

    term.onResize(({ cols, rows }) => {
      if (socket.connected) {
        socket.emit('ssh:resize', { cols, rows });
      }
    });
    
    // Improved resize handling with precision fitting
    const performFit = () => {
      if (!fitAddonRef.current || !terminalRef.current) return;
      try {
        fitAddonRef.current.fit();
      } catch (e) {
        console.warn('Terminal fit failed:', e);
      }
    };

    const handleResize = () => performFit();
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      // Small delay helps flexbox layouts finish settling
      setTimeout(performFit, 0);
      setTimeout(performFit, 50);
    });

    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [connectionId, appState.dbConfig?.uri, updateConnectionStatus]);

  // Handle Dynamic Theme Updates for XTerm
  useEffect(() => {
    if (!termInstanceRef.current) return;
    
    const settings = osState?.terminalSettings || {};
    const preset = TERMINAL_PRESETS[settings.activePreset || 'modern'] || TERMINAL_PRESETS.modern;
    const isRetro = settings.activePreset === 'retro';
    const bgOpacity = settings.backgroundOpacity ?? 1;
    const baseBg = settings.theme?.background || preset.theme?.background || '#0c0c0c';
    
    termInstanceRef.current.options = {
      fontFamily: settings.fontFamily || preset.fontFamily,
      fontSize: settings.fontSize || preset.fontSize,
      fontWeight: settings.fontWeight || preset.fontWeight || 'normal',
      letterSpacing: settings.letterSpacing || preset.letterSpacing || 0,
      cursorStyle: settings.cursorStyle || preset.cursorStyle || 'bar',
      cursorBlink: settings.cursorBlink !== undefined ? settings.cursorBlink : true,
      theme: {
        ...(preset.theme || {}),
        ...(settings.theme || {}),
        background: hexToRgba(baseBg, bgOpacity)
      }
    };

    // Force redraw and re-measure after fonts are ready
    const triggerRefresh = () => {
      try { 
        fitAddonRef.current?.fit(); 
        termInstanceRef.current?.refresh(0, termInstanceRef.current.rows - 1);
      } catch (e) {}
    };

    if (document.fonts) {
      document.fonts.ready.then(triggerRefresh);
    }
    
    setTimeout(triggerRefresh, 200);
    setTimeout(triggerRefresh, 1000); // Heavy fallback for lazy loading
  }, [osState?.terminalSettings, t]);

  const redactSecrets = (text) => {
    let t = String(text || '');
    // Common secret patterns
    t = t.replace(/(authorization:\s*bearer\s+)([^\s]+)/gi, '$1[REDACTED]');
    t = t.replace(/(api[_-]?key\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    t = t.replace(/(token\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    t = t.replace(/(password\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    t = t.replace(/(secret\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    // .env style assignments (best-effort)
    t = t.replace(/^(\s*[A-Z0-9_]+\s*=\s*)(.+)$/gmi, (m, k, v) => {
      if (/(KEY|TOKEN|SECRET|PASS|PASSWORD|PRIVATE|AUTH|BEARER)/i.test(String(k || ''))) {
        return `${k}[REDACTED]`;
      }
      return m;
    });
    return t;
  };

  // Detect if a command is sensitive/dangerous and requires user confirmation
  const isSensitiveCommand = (command) => {
    const cmd = String(command || '').toLowerCase().trim();
    if (!cmd) return false;

    // File overwrite / replace patterns (high risk: can wipe existing code)
    // We only treat these as sensitive when AI is in code-editor mode.
    const overwritePatterns = [
      /\bcat\s+<<\s*'eof'\s*>\s*[^\s]+/i,  // cat <<'EOF' > file
      /\bcat\s+<<\s*eof\s*>\s*[^\s]+/i,    // cat <<EOF > file
      /\btee\s+[^\s]+\s*>\s*\/dev\/null/i, // tee file > /dev/null (used with sudo)
      /\bprintf\b[\s\S]*>\s*[^\s]+/i,       // printf ... > file
      /\becho\b[\s\S]*>\s*[^\s]+/i,         // echo ... > file
    ];
    if (sshAiPrefs?.aiTask === 'code' && overwritePatterns.some(p => p.test(cmd))) {
      return true;
    }

    // Destructive patterns
    const destructivePatterns = [
      /rm\s+-[rf]+/i,           // rm -rf, rm -r -f
      /rm\s+.*\*/i,             // rm with wildcards
      /mkfs\./i,                // Format filesystem
      /dd\s+if=/i,              // dd with input file
      /fdisk/i,                 // Partition manipulation
      /parted/i,                // Partition editing
      /userdel/i,               // Delete user
      /groupdel/i,              // Delete group
      /passwd\s+/i,             // Change password
      /iptables.*-F/i,          // Flush firewall rules
      /ufw.*disable/i,          // Disable firewall
      /sshd.*stop/i,            // Stop SSH service
      /systemctl.*stop.*ssh/i,  // Stop SSH
      /chown\s+-R/i,            // Recursive chown
      /chmod\s+-R/i,            // Recursive chmod
      /mkfs\s+/i,               // Make filesystem
      /dd\s+.*of=\/dev\/sd/i,   // Write to disk device
      /echo.*>.*\/etc\/passwd/i, // Modify passwd file
      /echo.*>.*\/etc\/shadow/i, // Modify shadow file
    ];

    // System file modifications
    const systemFilePatterns = [
      /\/etc\/sshd?(_config)?/i,
      /\/etc\/passwd/i,
      /\/etc\/shadow/i,
      /\/etc\/sudoers/i,
      /\/etc\/hosts/i,
      /\/etc\/fstab/i,
      /\/boot\//i,
      /\/dev\/sd[a-z]/i,
    ];

    return destructivePatterns.some(p => p.test(cmd)) ||
           systemFilePatterns.some(p => p.test(cmd));
  };

  const parseAiAnswer = (raw, metadata) => {
    const decodeEntities = (str) => {
      const entities = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&#x2F;': '/', '&#x60;': '`', '&#x3D;': '='
      };
      return String(str || '').replace(/&[#\w\d]+;/g, (m) => entities[m] || m);
    };

    const getTag = (tag) => {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'gi');
      let m;
      let lastMatch = '';
      while ((m = regex.exec(String(raw || ''))) !== null) {
        lastMatch = m[1].trim();
      }
      return lastMatch;
    };

    const cleanDiffContent = (text) => {
      let d = String(text || '').trim();
      // If there's garbage before the first diff header, strip it
      // Allow leading whitespace in the header check
      const firstHeader = d.search(/(^\s*--- |^\s*\+\+\+ |^\s*@@ |^\s*diff )/m);
      if (firstHeader > 0) {
        d = d.slice(firstHeader);
      }
      return d;
    };

    let command = getTag('command');
    let safetyBlocked = false;
    
    // 🧪 ROBUSTNESS: If the AI put markdown code blocks INSIDE the <command> tag (common mistake), extract them.
    if (command.includes('```')) {
      const innerMdMatch = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/i.exec(command);
      if (innerMdMatch) {
        command = innerMdMatch[1].trim();
      }
    }

    // 🧪 AUTO-RECOVERY: If no <command> tag but markdown code blocks exist (lazy AI)
    if (!command.trim()) {
      const mdBashRegex = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/i;
      const mdMatch = mdBashRegex.exec(String(raw || ''));
      if (mdMatch) {
         command = mdMatch[1].trim();
         console.log('[AI Agent] Recovered command from markdown block:', command);
      }
    }

    // 🧪 CLEANUP: Remove common AI descriptive headers if they leaked into the command
    // Use global /g flag to remove ALL occurrences of step headers and prose
    command = command.replace(/^\s*\*\*Step\s+\d+[:.]?.*?\*\*\s*(\n\s*)*/gi, '');
    command = command.replace(/^\s*###?\s+Step\s+\d+[:.]?.*?\n/gi, ''); // Also catch # Step 1:
    command = command.replace(/^\s*Run the following (command|code|script).*?[:.]?(\n\s*)*/gi, '');
    command = command.replace(/^\s*Here is the command to.*?:(\n\s*)*/gi, '');
    command = command.trim();

    let explain = getTag('explain');
    // 🧪 ROBUSTNESS: If AI provides raw text without <explain> tag, use it as the explanation
    if (!explain.trim()) {
       const cleanRaw = String(raw || '').replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gi, '').trim();
       if (cleanRaw) {
          explain = cleanRaw.split('\n')[0].slice(0, 150) + (cleanRaw.length > 150 ? '...' : '');
       }
    }

    // 🚨 CRITICAL SAFETY: Block error messages being sent as commands.
    // The AI sometimes copies terminal error output into <command> tags (e.g. GLIBC errors).
    // Executing error text as bash can break the terminal (unmatched backticks → hung prompt).
    const errorMessagePatterns = [
      /version\s+[`']?GLIBC/i,                          // GLIBC_2.39 not found
      /not found \(required by/i,                         // shared lib error
      /\/lib(?:64)?\/.*\.so[.\d]*:\s/i,                  // /lib64/libc.so.6: ...
      /:\s+permission denied/i,                           // bash: permission denied
      /:\s+command not found$/im,                         // bash: xyz: command not found
      /:\s+No such file or directory$/im,                // bash: xyz: No such file
      /^error:\s/im,                                      // error: could not find...
      /^fatal:\s/im,                                      // fatal: ...
      /Traceback \(most recent call last\)/i,             // Python traceback
      /^-bash:\s/im,                                      // -bash: ....
      /^failed to solve:/i,                               // docker build error
      /^process.*did not complete successfully: exit code:/i // generic compiler error
    ];
    
    if (errorMessagePatterns.some(p => p.test(command))) {
      console.warn('[AI Agent] 🚨 Blocked error message as command:', command.slice(0, 120));
      safetyBlocked = true;
      // Save the error text for display, but do NOT execute it
      const safetyNote = `⚠️ AI tried to run an error message as a command: "${command.slice(0, 100)}..."`;
      if (!explain.trim()) explain = safetyNote;
      else explain = safetyNote + "\n\n" + explain;
      command = '';
    }

    // 🧪 SAFETY: Block conversational text masquerading as a command
    // "Next, create a new file..." or "I will run..." should NOT be executed.
    const conversationalStart = /^(next,|please|merely|just|i will|let's|ok,|okay,|sure,|first,|then,|finally,)/i;
    // Common safe commands that might look like english but are valid
    const isSafeCommand = /^(echo|printf|cat|ls|cd|pwd|grep|find|git|npm|pm2|docker|sudo|rm|mv|cp|mkdir|touch|diff|patch|make|service|systemctl|journalctl|ssh|scp|curl|wget|tar|zip|unzip|gzip|gunzip|nano|vim|vi|pico|emacs|head|tail|less|more|whoami|id|groups|users|ps|top|htop|kill|pkill|killall|fuser|lsof|netstat|ss|ip|ifconfig|route|ping|traceroute|dig|nslookup|host|whois|uptime|w|who|last|history|export|unset|env|set|alias|unalias|source|\.|bash|sh|zsh|python|perl|ruby|php|node|deno|go|rustc|gcc|g\+\+|clang|clang\+\+|javac|java|jar)/;
    
    if (conversationalStart.test(command) && !isSafeCommand.test(command)) {
        console.warn('[AI Agent] Blocked conversational command:', command);
        command = '';
    }

    if (command.includes('&')) command = decodeEntities(command);

    const dangerRaw = getTag('danger');
    const warn = getTag('warn');
    const doneRaw = getTag('done');
    let diff = getTag('diff');
    
    // 🧪 ROBUSTNESS: MD Diff Fallback
    if (!diff.trim()) {
      const mdDiffRegex = /```(?:diff|patch)\n([\s\S]*?)```/i;
      const mdMatch = mdDiffRegex.exec(String(raw || ''));
      if (mdMatch) {
         diff = mdMatch[1].trim();
         console.log('[AI Agent] Recovered diff from markdown block:', diff);
      } else if (String(raw || '').includes('--- ') && String(raw || '').includes('+++ ')) {
         // Raw diff detection
         const rawMatch = String(raw || '').match(/(?:--- |@@ |diff -u)[\s\S]+/i);
         if (rawMatch) diff = rawMatch[0];
      }
    }

    if (diff) {
      diff = cleanDiffContent(diff);
      if (diff.includes('&')) diff = decodeEntities(diff);
    }
    const plan = getTag('plan');
    const thought = getTag('thought');
    const interactive = getTag('interactive');
    const searchSkills = getTag('search_skills');
    const stepRaw = getTag('step');
    const danger = String(dangerRaw || '').trim().toLowerCase() === 'true';
    const doneRawLower = String(doneRaw || '').trim().toLowerCase();
    let done = doneRawLower === 'true';

    // 🧪 ROBUSTNESS: Done Detection
    // If we have text that suggests completion, and the AI didn't provide a command/diff, override done=true.
    // BUT: NEVER override to done=true if the raw AI response mentions errors/failures.
    const rawNoTags = String(raw || '').replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gi, '').trim();
    const isImplicitDone = looksLikeCompletionText(explain) || looksLikeCompletionText(thought) || looksLikeCompletionText(rawNoTags);
    const hasNoAction = !command.trim() && !diff.trim() && !searchSkills.trim();
    
    // 🛡️ ANTI-FALSE-POSITIVE: Check if the raw response itself mentions errors/failures
    // This catches cases where the AI says "task complete" but its own thought mentions errors
    const rawLower = String(raw || '').toLowerCase();
    const hasErrorInResponse = /(permission denied|glibc.*not found|error:|failed|could not find|cannot connect|not running|docker.*denied)/i.test(rawLower);
    
    if (isImplicitDone && !hasErrorInResponse && (doneRawLower !== 'true' && hasNoAction)) {
      done = true;
    } else if (!doneRawLower && isImplicitDone && !hasErrorInResponse) {
      done = true;
    }

    // NOTE: The model uses <done>false</done> for normal "in progress" steps.
    // Only treat done=false as a failure (stop Auto Mode) when the AI is explicitly giving up.
    const explainLower = String(explain || '').toLowerCase();
    const hasWorkOutput = !!(String(command || '').trim() || String(diff || '').trim() || String(searchSkills || '').trim());
    const giveUpSignals = [
      "cannot", "can't", "unable", "not possible", "no way", "blocked", "permission denied",
      "i don't have", "insufficient", "give up", "cannot be completed", "can't be completed",
      "cannot proceed", "unable to proceed", "stuck"
    ];
    const isGiveUpExplain = giveUpSignals.some(s => explainLower.includes(s));
    const doneFailed = doneRawLower === 'false' && !!doneRaw && (!hasWorkOutput) && isGiveUpExplain;
    const step = parseInt(stepRaw) || 1;

    // 🧪 Clean up redundant meta-text from explain/thought that AI repeats from hints
    const cleanupMetaText = (text) => {
      if (!text) return text;
      return text
        // ☢️ NUCLEAR FILTER: Catch almost any sentence about goal satisfaction/terminal evidence
        .replace(/(?:since|given|based on|according to|the recent|the provided)[\s\S]*?(?:goal|task|evidence|output|status|command|logs|shows|it is clear)[\s\S]*?(?:satisfied|met|done|finished|complete|resolved|achieved|success|is already|no need to continue)[\s\S]*?(\.|$|!)/gi, '')
        .replace(/recent terminal evidence (?:clearly )?(?:suggests|shows|indicates)[\s\S]*?(\.|$|!)/gi, '')
        .replace(/HINT: [\s\S]*?satisfied[\s\S]*?\./gi, '')
        .replace(/I have (?:verified|confirmed)[\s\S]*?goal is (?:already )?(?:met|satisfied|done)[\s\S]*?(\.|$|!)/gi, '')
        .replace(/The goal of [\s\S]*? is already (?:satisfied|met|done)[\s\S]*?(\.|$|!)/gi, '')
        .trim();
    };

    return { 
      command, 
      diff, 
      explain: cleanupMetaText(explain), 
      danger, 
      warn, 
      done, 
      doneFailed, 
      interactive, 
      plan, 
      thought: cleanupMetaText(thought), 
      searchSkills, 
      step, 
      usedModel: metadata?.usedModel, 
      safetyBlocked,
      raw: String(raw || '').trim() 
    };
  };

  const isValidUnifiedDiff = (diffText) => {
    const d = String(diffText || '').replace(/\r\n/g, '\n').trim();
    if (!d) return false;
    
    const lines = d.split('\n');
    let foundMinus = false;
    let foundPlus = false;
    let foundHunk = false;
    let foundChange = false;
    let inHunk = false;
    
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];          // keep original (leading space = context line!)
      const trimmed = raw.trim();     // only for header detection
      if (trimmed.startsWith('--- ')) {
        foundMinus = true;
        inHunk = false;
        continue;
      }
      if (trimmed.startsWith('+++ ')) {
        foundPlus = true;
        inHunk = false;
        continue;
      }
      if (trimmed.startsWith('@@ ')) {
        foundHunk = true;
        inHunk = true;
        continue;
      }
      if (inHunk) {
        if (trimmed.startsWith('diff ') || trimmed.startsWith('index ')) {
          inHunk = false;
          continue;
        }
        if (raw.startsWith('+') || raw.startsWith('-')) {
          foundChange = true;
        }
        // Inside a hunk, every line MUST start with ' ', '+', '-', or '\' (no newline marker)
        // Use RAW line (not trimmed) so context lines keep their leading space
        if (raw.length > 0 && !/^[ \+\-\\]/.test(raw)) {
          // Don't reject — DMP can handle slightly malformed diffs via fuzzy matching
          // Just skip validation for this line
        }
      }
    }
    // Only require hunk header + at least one --- or +++ header + at least one change
    return foundHunk && (foundMinus || foundPlus) && foundChange;
  };

  const applyUnifiedWithDMP = (originalText, unifiedDiff) => {
    try {
      const dmp = new diff_match_patch();
      const patches = dmp.patch_fromText(unifiedDiff);
      const [newText, results] = dmp.patch_apply(patches, originalText);
      const success = results.every(r => r === true);
      return { success, newText, results };
    } catch (e) {
      console.error('DMP Patch Error:', e);
      return { success: false, error: e.message };
    }
  };

  const repairDiffWithDMP = (diffText) => {
    const d = String(diffText || '').replace(/\r\n/g, '\n');
    const lines = d.split('\n');
    const fixed = [];
    let inHunk = false;
    for (let line of lines) {
      if (line.startsWith('@@ ')) {
        inHunk = true;
        fixed.push(line);
        continue;
      }
      if (inHunk) {
        if (/^--- |^\+\+\+ |^diff |^index /.test(line)) {
          inHunk = false;
          fixed.push(line);
          continue;
        }
        if (/^[ \+\-]/.test(line)) {
          fixed.push(line);
        } else if (line.trim() === '') {
          fixed.push(' ');
        } else {
          fixed.push(' ' + line);
        }
      } else {
        fixed.push(line);
      }
    }
    return fixed.join('\n');
  };

  const rewriteDiffPathsForPatch = (diffText) => {
    // 🛡️ Pre-sanitize: Fix minor malformations using DMP-inspired repair
    const sanitized = repairDiffWithDMP(diffText);
    let d = String(sanitized || '').replace(/\r\n/g, '\n');
    if (!d.trim()) return '';

    // 🔧 Tilde Fix: AI sometimes writes /~/ which is invalid (e.g. "/~/.zeroclaw/foo" → "~/.zeroclaw/foo")
    d = d.split('\n').map(line => {
      if ((line.startsWith('--- /~') || line.startsWith('+++ /~'))) {
        return line.replace(/^((?:--- |\+\+\+ ))\/~/, '$1~');
      }
      return line;
    }).join('\n');

    const lines = d.split('\n');
    const processedLines = [];
    let currentHunk = null; // { headerIdx: number, oldStart: number, oldLines: number, newStart: number, newLines: number, actualOld: number, actualNew: number }

    const finalizeHunk = () => {
      if (!currentHunk) return;
      const { headerIdx, oldStart, actualOld, newStart, actualNew } = currentHunk;
      // Update the @@ line with actual counts
      processedLines[headerIdx] = `@@ -${oldStart},${actualOld} +${newStart},${actualNew} @@`;
      currentHunk = null;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      // 🚨 AUTO-FIX: Split merged headers
      if (trimmed.startsWith('--- ') && trimmed.includes(' +++ ')) {
        const parts = line.split(' +++ ');
        const minusLine = parts[0];
        const plusLine = '+++ ' + parts[1];
        lines.splice(i + 1, 0, plusLine);
        line = minusLine;
        trimmed = line.trim();
      }

      // Handle File Headers
      if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ') || trimmed.startsWith('diff ') || trimmed.startsWith('index ')) {
        finalizeHunk();
        if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ')) {
          const prefix = trimmed.slice(0, 4);
          let rest = trimmed.slice(4);
          const parts = rest.split('\t');
          let p = (parts[0] || '').trim();
          
          if (p.startsWith('a/')) p = p.slice(2);
          if (p.startsWith('b/')) p = p.slice(2);

          // 🎯 Priority 0: @mentioned file paths — suffix-match handles both bare and relative paths
          // e.g., AI writes "chart_analysis/draw_on_chart.py" → we map it to the full mentioned path
          const _mentionedPaths = mentionedFilesRef.current || [];
          if (_mentionedPaths.length > 0) {
            const mentionedSuffix = _mentionedPaths.find(mp => {
              // exact match, or the AI's `p` is a suffix of the mentioned absolute path
              return mp === p || mp.endsWith('/' + p) || p.endsWith('/' + mp.split('/').pop());
            });
            if (mentionedSuffix) {
              p = mentionedSuffix;
              const suffix = parts.length > 1 ? '\t' + parts.slice(1).join('\t') : '';
              processedLines.push(`${prefix}${p}${suffix}`);
              continue;
            }
          }

          // Smart Path Resolution: 
          const isBare = !p.includes('/') || (p.startsWith('/') && p.lastIndexOf('/') === 0);
          if (isBare) {
            const fileName = p.split('/').pop();
            let absoluteMatch = null;

            // 1. Try to resolve relative to CWD first (Priority)
            if (sshMemory?.cwd) {
              const cwd = sshMemory.cwd.endsWith('/') ? sshMemory.cwd.slice(0, -1) : sshMemory.cwd;
              absoluteMatch = cwd + '/' + fileName;
            }
            
            // 2. Fallback to memory keyPaths if CWD didn't help (or file needs system-wide matching)
            if (!absoluteMatch && sshMemory?.keyPaths?.length) {
              absoluteMatch = sshMemory.keyPaths.find(kp => kp.endsWith('/' + fileName) || kp === fileName);
            }
            
            if (absoluteMatch) {
              p = absoluteMatch;
            }
          }
          
          if (p && !p.startsWith('/') && !p.startsWith('~') && p.includes('/')) {
            p = '/' + p;
          }
          const suffix = parts.length > 1 ? '\t' + parts.slice(1).join('\t') : '';
          processedLines.push(`${prefix}${p}${suffix}`);
        } else {
          processedLines.push(trimmed);
        }
        continue;
      }

      // Handle Hunk Headers
      if (trimmed.startsWith('@@ ')) {
        finalizeHunk();
        const headerMatch = trimmed.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (headerMatch) {
          const oldStart = parseInt(headerMatch[1]);
          const newStart = parseInt(headerMatch[3]);
          currentHunk = { headerIdx: processedLines.length, oldStart, actualOld: 0, newStart, actualNew: 0 };
          processedLines.push(trimmed);
        } else {
          processedLines.push(trimmed);
        }
        continue;
      }

      // Handle Hunk Content
      if (currentHunk) {
        // AI sometimes sends blank lines for context, but standard patch requires a ' '
        if (line.startsWith(' ') || trimmed === '') {
          // 🛡️ SMART HEAL: If the line is totally empty but the AI meant it as context, 
          // we only count it if it's not a placeholder at the start/end of a hunk.
          currentHunk.actualOld++;
          currentHunk.actualNew++;
          processedLines.push(line.startsWith(' ') ? line : ' ' + line);
        } else if (line.startsWith('-')) {
          currentHunk.actualOld++;
          processedLines.push(line);
        } else if (line.startsWith('+')) {
          currentHunk.actualNew++;
          processedLines.push(line);
        } else {
          finalizeHunk();
          processedLines.push(line);
        }
      } else {
        // Outside hunk, just push
        processedLines.push(line);
      }
    }

    // Finalize the last hunk if any
    finalizeHunk();
    
    // 🛡️ EMERGENCY REPAIR: If the AI produced an invalid "empty" hunk like @@ -0,0 +0,0 @@
    // we convert it to a valid "remove everything" hunk if possible, or just skip it.
    const finalLines = processedLines.filter(l => {
      const trim = l.trim();
      if (trim.startsWith('@@') && (l.includes('-0,0 +0,0') || l.includes('-1,0 +1,0'))) return false;
      return true;
    });

    // Ensure the diff is actually valid and has hunks
    if (!finalLines.some(l => l.trim().startsWith('@@ '))) return '';

    return finalLines.join('\n').trimEnd() + '\n';
  };

  // ── Apply Patch via SFTP + diff-match-patch (server-side) ──────────────────
  const applyPatchViaSftp = (diffText, backupId) => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Socket not connected' });
        return;
      }

      const d = rewriteDiffPathsForPatch(diffText);
      if (!d) {
        resolve({ success: false, error: 'Invalid diff (empty after path rewrite)' });
        return;
      }
      if (!isValidUnifiedDiff(d)) {
        resolve({ success: false, error: 'Invalid unified diff format' });
        return;
      }

      // Extract files for rollback tracking
      const files = extractFilesFromUnifiedDiff(d);

      // Set up one-time result listener
      const onResult = (result) => {
        socketRef.current?.off('sftp:patchResult', onResult);
        clearTimeout(timeout);
        resolve({ ...result, files });
      };

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        socketRef.current?.off('sftp:patchResult', onResult);
        resolve({ success: false, error: 'Patch operation timed out (30s)', files });
      }, 30000);

      socketRef.current.on('sftp:patchResult', onResult);
      socketRef.current.emit('sftp:applyPatch', { diffText: d, backupId: backupId || null });
    });
  };

  const extractFilesFromUnifiedDiff = (diffText) => {
    const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
    const files = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('+++ ')) continue;
      let p = trimmed.slice(4).trim();
      if (!p || p === '/dev/null') continue;
      p = p.split('\t')[0].trim();
      if (p.startsWith('b/')) p = p.slice(2);
      if (p.startsWith('a/')) p = p.slice(2);
      if (p.startsWith('/') || p.startsWith('~')) {
        // Keep as is
      } else {
        if (!p.startsWith('~')) p = '/' + p;
      }
      if (!files.includes(p)) files.push(p);
    }
    return files;
  };


  const buildPatchRollbackCommand = (backup) => {
    const id = backup?.id;
    const files = Array.isArray(backup?.files) ? backup.files : [];
    if (!id || files.length === 0) return '';
    const list = files.map(f => `'${String(f).replace(/'/g, `'\\''`)}'`).join(' ');
    return `for f in ${list}; do if [ -f "$f.bak.${id}" ]; then mv "$f.bak.${id}" "$f"; fi; done`;
  };

  const openPatchModal = (diffText) => {
    setPatchModalDiff(diffText || '');
    setPatchModalAutoApplied(false);
    setPatchFileCollapsed({}); // reset so all files start expanded
    setPatchModalOpen(true);
  };

  useEffect(() => {
    if (!aiAnswer?.diff) return;
    if (sshAiPrefs?.aiTask !== 'code') return;
    if (sshAiPrefs?.enforcePatch === false) return;
    if (!sshAiPrefs?.autoApplyPatch) return;
    
    // ✋ If we are in Auto Mode (running loop), let 'runAutoStep' handle the execution 
    // to avoid double-sending the command. This effect is for Manual Mode auto-apply.
    if (autoModeRef.current) return;

    const d = String(aiAnswer.diff || '').trim();
    if (!d) return;
    if (lastAutoAppliedDiffRef.current === d) return;
    lastAutoAppliedDiffRef.current = d;

    const backupId = `${Date.now().toString(36)}`;
    
    setPatchModalDiff(d);
    setPatchModalAutoApplied(true);
    setPatchFileCollapsed({}); 
    setLastPatchResultData(null); // Clear for new diff
    setPatchModalOpen(true);

    // Apply via SFTP + diff-match-patch
    applyPatchViaSftp(d, backupId).then((result) => {
      const files = result.files || [];
      setLastPatchBackup({ id: backupId, files });
      setLastPatchResultData(result.results || null);
      if (result.success) {
        console.log('[Patch] Auto-applied successfully:', result.summary);
      } else {
        console.warn('[Patch] Auto-apply failed:', result.error || result.summary);
        setAiError(`Patch failed: ${result.error || result.summary || 'Unknown error'}`);
      }
    });

    // Auto-close modal after 4 seconds to keep UI clean during auto operations
    setTimeout(() => {
      setPatchModalOpen(prev => {
        if (prev && lastAutoAppliedDiffRef.current === d) return false;
        return prev;
      });
    }, 4000);
  }, [aiAnswer, sshAiPrefs?.aiTask, sshAiPrefs?.enforcePatch, sshAiPrefs?.autoApplyPatch]);

  const renderDiffLines = (diffText) => {
    const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      const isAdd = trimmed.startsWith('+') && !trimmed.startsWith('+++');
      const isDel = trimmed.startsWith('-') && !trimmed.startsWith('---');
      const isHunk = trimmed.startsWith('@@');
      const isFileHdr = trimmed.startsWith('--- ') || trimmed.startsWith('+++ ') || trimmed.startsWith('diff ') || trimmed.startsWith('index ');

      const sectionStart = trimmed.startsWith('diff ') || trimmed.startsWith('--- ');

      let cls = 'whitespace-pre px-3 py-[2px] text-[11px] font-mono';
      if (isAdd) cls += ' bg-emerald-500/15 text-emerald-200';
      else if (isDel) cls += ' bg-red-500/15 text-red-200';
      else if (isHunk) cls += ' bg-indigo-500/15 text-indigo-200 font-semibold';
      else if (isFileHdr) cls += ' bg-white/5 text-[var(--text-primary)] font-semibold';
      else cls += ' text-[var(--text-secondary)]';
      if (sectionStart && idx !== 0) cls += ' mt-2 border-t border-white/10';

      return (
        <div key={idx} className={cls}>
          {line || ' '}
        </div>
      );
    });
  };

  // Split a unified diff into per-file sections with VS Code-style colored view
  // Green = added, Red = removed, normal = context (unchanged). Per-file rollback supported.
  const renderDiffByFile = (diffText, collapsedState, setCollapsedState, backup, onRollbackFile) => {
    const rawLines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');

    // ── Parse into file sections ──────────────────────────────────────────────
    const fileSections = [];
    let current = null;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('diff ')) {
        if (current) fileSections.push(current);
        current = { lines: [line], filename: '' };
      } else if (trimmed.startsWith('--- ') && !trimmed.startsWith('--- a/')) {
        const nextLine = (rawLines[i + 1] || '').trim();
        if (nextLine.startsWith('+++ ')) {
          if (current) fileSections.push(current);
          const rawName = trimmed.replace(/^--- /, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
          current = { lines: [line], filename: rawName };
        } else if (current) {
          current.lines.push(line);
        }
      } else if (trimmed.startsWith('--- a/')) {
        if (current === null) {
          current = { lines: [line], filename: trimmed.replace(/^--- a\//, '').trim() };
        } else {
          current.filename = trimmed.replace(/^--- a\//, '').trim();
          current.lines.push(line);
        }
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) fileSections.push(current);

    // ── Fallback: no file boundary found ─────────────────────────────────────
    if (fileSections.length === 0) {
      return (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <div className="overflow-y-auto max-h-[420px] custom-scrollbar bg-black/40">
            {rawLines.map((line, idx) => {
              const isAdd = line.startsWith('+') && !line.startsWith('+++');
              const isDel = line.startsWith('-') && !line.startsWith('---');
              const isHunk = line.startsWith('@@');
              let cls = 'whitespace-pre-wrap break-all px-4 py-[1px] text-[11px] font-mono flex';
              if (isAdd) cls += ' bg-emerald-500/10 text-emerald-300';
              else if (isDel) cls += ' bg-red-500/10 text-red-300';
              else if (isHunk) cls += ' bg-indigo-500/20 text-indigo-300 font-semibold';
              else cls += ' text-[var(--text-secondary)]';
              return (
                <div key={idx} className={cls}>
                  <span className="w-5 shrink-0 opacity-30 text-right mr-3 select-none">
                    {isAdd ? '+' : isDel ? '−' : ' '}
                  </span>
                  <span>{line.slice(isAdd || isDel ? 1 : 0) || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Render per-file cards ─────────────────────────────────────────────────
    return fileSections.map((section, fi) => {
      const key = section.filename || String(fi);
      const isCollapsed = collapsedState?.[key] ?? false;

      // Count changes
      let added = 0, removed = 0;
      for (const ln of section.lines) {
        if (ln.startsWith('+') && !ln.startsWith('+++')) added++;
        if (ln.startsWith('-') && !ln.startsWith('---')) removed++;
      }

      const displayName = section.filename
        ? section.filename.split('/').pop() || section.filename
        : `File ${fi + 1}`;
      // Paths in the diff are relative to / (for patch -d /), so prepend / for display
      const fullPath = section.filename
        ? ((section.filename.startsWith('/') || section.filename.startsWith('~')) ? section.filename : '/' + section.filename)
        : '';

      // Can we roll back this specific file?
      const fileBackupExists = backup?.id && Array.isArray(backup?.files) &&
        backup.files.some(f => {
          const norm = (s) => s.replace(/^\/+/, '');
          return norm(f).endsWith(norm(fullPath)) || norm(fullPath).endsWith(norm(f));
        });

      // Build a full-view display list:
      // - Between hunks, gap lines are shown as plain grey (original/unchanged)
      // - Changed lines: green (+) or red (-)
      // - Context lines within hunks: normal color
      const displayLines = [];
      let newLineNo = 1;
      let prevHunkEndNewLine = 0; // tracks where last hunk ended in the new file

      // First pass: collect all hunks with their line ranges
      const hunks = [];
      let curHunk = null;
      for (const ln of section.lines) {
        const isFileMeta = ln.startsWith('---') || ln.startsWith('+++') || ln.startsWith('diff ') || ln.startsWith('index ');
        if (isFileMeta) continue;
        const hunkMatch = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
          if (curHunk) hunks.push(curHunk);
          curHunk = {
            oldStart: parseInt(hunkMatch[1], 10),
            newStart: parseInt(hunkMatch[3], 10),
            lines: [],
          };
          continue;
        }
        if (curHunk) curHunk.lines.push(ln);
      }
      if (curHunk) hunks.push(curHunk);

      // Second pass: render with gap placeholders
      let currentNewLine = 1;
      for (let hi = 0; hi < hunks.length; hi++) {
        const hunk = hunks[hi];
        const gapStart = currentNewLine;
        const gapEnd = hunk.newStart - 1;

        // Show gap lines as folded "N lines unchanged"
        if (gapEnd >= gapStart) {
          const gapCount = gapEnd - gapStart + 1;
          displayLines.push({ type: 'gap', count: gapCount, startLine: gapStart });
          currentNewLine = gapEnd + 1;
        }

        // Show hunk lines
        let lineNo = hunk.newStart;
        let oldLineNo = hunk.oldStart;
        for (const ln of hunk.lines) {
          const isAdd = ln.startsWith('+') && !ln.startsWith('+++');
          const isDel = ln.startsWith('-') && !ln.startsWith('---');
          if (isAdd) {
            displayLines.push({ type: 'add', text: ln.slice(1), lineNo });
            lineNo++;
          } else if (isDel) {
            displayLines.push({ type: 'del', text: ln.slice(1), lineNo: null });
            oldLineNo++;
          } else {
            displayLines.push({ type: 'ctx', text: ln.slice(1) || '', lineNo });
            lineNo++;
            oldLineNo++;
          }
        }
        currentNewLine = lineNo;
      }

      return (
        <div key={fi} className="rounded-xl border border-white/10 overflow-hidden mb-3 last:mb-0 shadow-sm">
          {/* ── File header ── */}
          <div className="flex items-center bg-[#1a1a2e] border-b border-white/10">
            <button
              type="button"
              onClick={() => setCollapsedState(prev => ({ ...prev, [key]: !isCollapsed }))}
              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <span className="text-[var(--text-muted)] shrink-0">
                {isCollapsed
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }
              </span>
              <span className="text-[12px] font-bold font-mono text-white truncate">{displayName}</span>
              {fullPath && fullPath !== displayName && (
                <span className="text-[10px] font-mono opacity-30 text-[var(--text-muted)] truncate hidden sm:inline ml-1">{fullPath}</span>
              )}
            </button>

            {/* Stats + per-file rollback */}
            <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
              <span className="text-[11px] font-mono font-bold text-emerald-400">+{added}</span>
              <span className="text-[10px] opacity-30 font-mono">/</span>
              <span className="text-[11px] font-mono font-bold text-red-400">-{removed}</span>
              {fileBackupExists && onRollbackFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRollbackFile(fullPath, backup.id); }}
                  className="ml-2 px-2 py-1 rounded text-[10px] font-bold border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 text-red-400 transition-all"
                  title={`Rollback ${displayName}`}
                >
                  ↩ Rollback
                </button>
              )}
            </div>
          </div>

          {/* ── Diff content ── */}
          {!isCollapsed && (
            <div className="overflow-y-auto max-h-[500px] custom-scrollbar font-mono text-[11px] bg-[#0d0d1a]">
              {displayLines.map((entry, li) => {
                if (entry.type === 'gap') {
                  return (
                    <div key={li} className="flex items-center gap-2 px-3 py-[3px] bg-[#111122]/60 border-y border-white/[0.04] text-[var(--text-muted)] opacity-40 text-[10px] select-none">
                      <span>···</span>
                      <span className="italic">{entry.count} unchanged line{entry.count !== 1 ? 's' : ''}</span>
                    </div>
                  );
                }

                const isAdd = entry.type === 'add';
                const isDel = entry.type === 'del';
                const lineNumStr = entry.lineNo != null ? String(entry.lineNo) : '';

                return (
                  <div key={li} className={`flex min-w-0 ${
                    isAdd ? 'bg-emerald-500/10 hover:bg-emerald-500/15' :
                    isDel ? 'bg-red-500/10 hover:bg-red-500/15' :
                    'hover:bg-white/[0.03]'
                  }`}>
                    {/* Line number gutter */}
                    <span className="w-10 shrink-0 px-2 py-[2px] text-right text-[10px] text-[var(--text-muted)] opacity-30 select-none border-r border-white/5">
                      {lineNumStr}
                    </span>
                    {/* +/- gutter */}
                    <span className={`w-5 shrink-0 px-1 py-[2px] text-center select-none ${
                      isAdd ? 'text-emerald-400' : isDel ? 'text-red-400' : 'text-[var(--text-muted)] opacity-20'
                    }`}>
                      {isAdd ? '+' : isDel ? '−' : ' '}
                    </span>
                    {/* Code content */}
                    <span className={`flex-1 py-[2px] px-2 whitespace-pre-wrap break-all ${
                      isAdd ? 'text-emerald-200' :
                      isDel ? 'text-red-200' :
                      'text-[var(--text-secondary)]'
                    }`}>
                      {entry.text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  // ── Render actual full-file post-patch diff using DMP ───────────────────────
  const renderDmpDiffByResult = (resultsArray, collapsedState, setCollapsedState, backup, onRollbackFile) => {
    if (!Array.isArray(resultsArray) || resultsArray.length === 0) return null;

    return resultsArray.map((result, fi) => {
      const fullPath = result.file;
      const displayName = fullPath.split('/').pop() || fullPath;
      const key = fullPath;
      const isCollapsed = collapsedState?.[key] ?? false;

      // Calculate diff using diff-match-patch
      const dmp = new diff_match_patch();
      // Calculate diffs between original and new
      const diffs = dmp.diff_main(result.originalContent || '', result.newContent || '');
      // Clean up diffs to be semantic line-by-line
      dmp.diff_cleanupSemantic(diffs);

      let added = 0;
      let removed = 0;
      
      const displayLines = [];
      let oldLine = 1;
      let newLine = 1;

      // diffs is array of [Operation, text]
      // Operation format: -1 = diff_match_patch.DIFF_DELETE, 1 = DIFF_INSERT, 0 = DIFF_EQUAL
      for (const [op, text] of diffs) {
        // text might be multiple lines, split by \n
        // Be careful: trailing \n means empty last element in split array
        const lines = text.split('\n');
        // if the last element is empty because of a trailing newline, remove it to avoid extra blank line
        if (lines[lines.length - 1] === '') lines.pop();

        for (const lineText of lines) {
          if (op === 1) { // Insert
            displayLines.push({ type: 'add', text: lineText, lineNo: newLine });
            newLine++;
            added++;
          } else if (op === -1) { // Delete
            displayLines.push({ type: 'del', text: lineText, lineNo: null });
            oldLine++;
            removed++;
          } else { // Equal
            displayLines.push({ type: 'ctx', text: lineText, lineNo: newLine });
            newLine++;
            oldLine++;
          }
        }
      }

      const fileBackupExists = backup?.id && Array.isArray(backup?.files) &&
        backup.files.some(f => {
          const norm = (s) => s.replace(/^\/+/, '');
          return norm(f).endsWith(norm(fullPath)) || norm(fullPath).endsWith(norm(f));
        });

      // Now we have a huge list of displayLines containing the entire file.
      // We can also collapse context areas (gap lines) if there are too many ctx lines in a row.
      const foldedLines = [];
      const CONTEXT_SIZE = 3;
      let i = 0;
      
      while (i < displayLines.length) {
        if (displayLines[i].type !== 'ctx') {
          foldedLines.push(displayLines[i]);
          i++;
          continue;
        }

        // Count consecutive "ctx" lines
        let ctxCount = 0;
        let startIdx = i;
        while (i < displayLines.length && displayLines[i].type === 'ctx') {
          ctxCount++;
          i++;
        }

        if (ctxCount > CONTEXT_SIZE * 2 + 1) {
          // Add first few context lines
          for (let j = 0; j < CONTEXT_SIZE; j++) {
            foldedLines.push(displayLines[startIdx + j]);
          }
          // Add the gap
          const hiddenCount = ctxCount - (CONTEXT_SIZE * 2);
          foldedLines.push({ type: 'gap', count: hiddenCount });
          // Add the last few context lines
          for (let j = 0; j < CONTEXT_SIZE; j++) {
            foldedLines.push(displayLines[i - CONTEXT_SIZE + j]);
          }
        } else {
          // Just push all ctx lines if it's small enough
          for (let j = startIdx; j < i; j++) {
            foldedLines.push(displayLines[j]);
          }
        }
      }

      return (
        <div key={key} className="rounded-xl border border-white/10 overflow-hidden mb-3 last:mb-0 shadow-sm">
          {/* FILE HEADER HTML IDENTICAL TO RENDERDIFFBYFILE */}
          <div className="flex items-center bg-[#1a1a2e] border-b border-white/10">
            <button
              type="button"
              onClick={() => setCollapsedState(prev => ({ ...prev, [key]: !isCollapsed }))}
              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <span className="text-[var(--text-muted)] shrink-0">
                {isCollapsed
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }
              </span>
              <span className="text-[12px] font-bold font-mono text-white truncate">{displayName}</span>
              {fullPath && fullPath !== displayName && (
                <span className="text-[10px] font-mono opacity-30 text-[var(--text-muted)] truncate hidden sm:inline ml-1">{fullPath}</span>
              )}
              {!result.success && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 ml-2">{t('ai.failedSmall')}</span>
              )}
            </button>

            <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
              <span className="text-[11px] font-mono font-bold text-emerald-400">+{added}</span>
              <span className="text-[10px] opacity-30 font-mono">/</span>
              <span className="text-[11px] font-mono font-bold text-red-400">-{removed}</span>
              {fileBackupExists && onRollbackFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRollbackFile(fullPath, backup.id); }}
                  className="ml-2 px-2 py-1 rounded text-[10px] font-bold border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 text-red-400 transition-all"
                  title={`Rollback ${displayName}`}
                >
                  ↩ Rollback
                </button>
              )}
            </div>
          </div>

          {/* DIFF CONTENT */}
          {!isCollapsed && (
            <div className="overflow-y-auto max-h-[500px] custom-scrollbar font-mono text-[11px] bg-[#0d0d1a]">
              {foldedLines.map((entry, li) => {
                if (entry.type === 'gap') {
                  return (
                    <div key={li} className="flex items-center gap-2 px-3 py-[3px] bg-[#111122]/60 border-y border-white/[0.04] text-[var(--text-muted)] opacity-40 text-[10px] select-none">
                      <span>···</span>
                      <span className="italic">{entry.count} unchanged line{entry.count !== 1 ? 's' : ''}</span>
                    </div>
                  );
                }

                const isAdd = entry.type === 'add';
                const isDel = entry.type === 'del';
                const lineNumStr = entry.lineNo != null ? String(entry.lineNo) : '';

                return (
                  <div key={li} className={`flex min-w-0 ${
                    isAdd ? 'bg-emerald-500/10 hover:bg-emerald-500/15' :
                    isDel ? 'bg-red-500/10 hover:bg-red-500/15' :
                    'hover:bg-white/[0.03]'
                  }`}>
                    <span className="w-10 shrink-0 px-2 py-[2px] text-right text-[10px] text-[var(--text-muted)] opacity-30 select-none border-r border-white/5">
                      {lineNumStr}
                    </span>
                    <span className={`w-5 shrink-0 px-1 py-[2px] text-center select-none ${
                      isAdd ? 'text-emerald-400' : isDel ? 'text-red-400' : 'text-[var(--text-muted)] opacity-20'
                    }`}>
                      {isAdd ? '+' : isDel ? '−' : ' '}
                    </span>
                    <span className={`flex-1 py-[2px] px-2 whitespace-pre-wrap break-all ${
                      isAdd ? 'text-emerald-200' :
                      isDel ? 'text-red-200' :
                      'text-[var(--text-secondary)]'
                    }`}>
                      {entry.text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  const getOutputContext = () => {
    const maxLines = 100;
    const maxChars = 15000;
    const lines = outputLinesRef.current.slice(-maxLines);
    const joined = lines.join('\n') + (outputBufferRef.current ? '\n' + outputBufferRef.current : '');
    return joined.length > maxChars ? joined.slice(-maxChars) : joined;
  };

  const getOutputContextForAi = () => {
    const maxLines = 200;
    const maxChars = 15000;
    const lines = outputLinesRef.current.slice(-maxLines);
    const joined = lines.join('\n') + (outputBufferRef.current ? '\n' + outputBufferRef.current : '');
    const tail = joined.length > maxChars ? joined.slice(-maxChars) : joined;
    return redactSecrets(tail);
  };

  const extractEnvFromPrompt = (text) => {
    const lines = String(text || '').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      // Match pattern: user@host:cwd$ or [user@host cwd]$
      const m = /([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):([^$#%>]+)[$#%>]/.exec(line);
      if (m) {
        return { user: m[1], hostname: m[2], cwd: m[3].trim() };
      }
      // Brackets style: [root@server ~]#
      const m2 = /\[([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+)\s+([^\]]+)\][$#%>]/.exec(line);
      if (m2) {
        return { user: m2[1], hostname: m2[2], cwd: m2[3].trim() };
      }
    }
    return null;
  };

  const buildAiContextPack = (snapshotOverride) => {
    const snap = String(snapshotOverride ?? getOutputContextForAi() ?? '').trim();
    const err = detectTerminalError(snap);
    const env = extractEnvFromPrompt(snap);

    return {
      connectionName: connectionName || '?',
      host: host || '?',
      user: env?.user || 'unknown',
      cwd: env?.cwd || 'unknown',
      hostname: env?.hostname || 'unknown',
      lastCommand: String(lastExecutedCommand || ''),
      recentCommands: (recentCommandsRef.current || []).slice(-30),
      lastError: err ? { label: err.label, excerpt: redactSecrets(String(err.excerpt || '')) } : null,
      terminalTail: snap,
    };
  };

  const normalizeForLoop = (text) => {
    const raw = String(text || '');
    const lines = raw
      .split('\n')
      .map((l) => String(l).replace(/\x1b\[[0-9;]*m/g, '').trimEnd())
      .filter((l) => {
        const s = String(l || '').trim();
        if (!s) return false;
        if (/^last metadata expiration check:/i.test(s)) return false;
        if (/^last login:/i.test(s)) return false;
        if (/^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}/.test(s)) return false;
        return true;
      });
    return lines.slice(-40).join('\n');
  };

  const computeErrorSignature = (snap) => {
    const normalized = normalizeForLoop(snap);
    const err = detectTerminalError(normalized);
    const label = String(err?.label || '').toLowerCase();
    const excerpt = String(err?.excerpt || normalized).toLowerCase();
    const patterns = [
      /no match for argument:\s*([^\s]+)/i,
      /unable to find a match:\s*([^\s]+)/i,
      /no matching packages to list/i,
      /no package\s+([^\s]+)\s+available/i,
      /command not found/i,
      /permission denied/i,
      /could not resolve host/i,
      /temporary failure in name resolution/i,
      /connection timed out/i,
      /failed to.*(download|fetch)/i,
      /404 not found/i,
      /not found/i,
    ];
    let hit = '';
    for (const re of patterns) {
      const m = re.exec(excerpt);
      if (m) {
        hit = m[0];
        if (m[1]) hit = `${m[0]}:${m[1]}`;
        break;
      }
    }
    const tail = normalized.slice(-220);
    const sig = [label || 'none', hit || 'none', tail].join('::');
    return sig;
  };

  const buildSafeDiagnostics = (lastCmd, snap) => {
    const cmd = String(lastCmd || '').toLowerCase();
    const normalized = normalizeForLoop(snap);
    const sig = computeErrorSignature(normalized);

    const diags = [];
    // Always-safe environment basics
    diags.push('pwd && whoami && hostname');
    diags.push('uname -a');
    diags.push('cat /etc/os-release 2>/dev/null || lsb_release -a 2>/dev/null || sw_vers 2>/dev/null');

    // Package-manager context when installs fail
    const looksLikePkg = /(dnf|yum|apt-get|apt|apk|pacman|zypper)\b/.test(cmd) || /(no match for argument|unable to find a match|no package|no matching packages)/i.test(sig);
    if (looksLikePkg) {
      diags.push('command -v dnf yum apt-get apt apk pacman zypper 2>/dev/null | cat');
      // Repo visibility checks (non-destructive). Use conditional execution to avoid errors.
      diags.push('command -v dnf >/dev/null 2>&1 && dnf repolist -v || true');
      diags.push('command -v yum >/dev/null 2>&1 && yum repolist -v || true');
      diags.push('command -v apt-get >/dev/null 2>&1 && apt-cache policy || true');
      diags.push('command -v apk >/dev/null 2>&1 && apk info -vv 2>/dev/null || true');
    }

    // Command-not-found context
    if (/command not found/i.test(sig) || /no match for argument:\s*pm2/i.test(sig) || /unable to find a match:\s*pm2/i.test(sig)) {
      diags.push('command -v pm2 node npm npx 2>/dev/null | cat');
      diags.push('node -v 2>/dev/null || true');
      diags.push('npm -v 2>/dev/null || true');
    }

    // Keep it short to avoid spending too many steps
    return diags.slice(0, 5);
  };

  // Shared helper: detect commands that are expected to run silently for a long time
  // (package installs, downloads, builds). Used by waitForCommandSettle AND runAutoStep.
  const isHeavyCommand = (cmd) => {
    const c = String(cmd || '').toLowerCase();
    return /\b(install|update|upgrade|setup|deploy|create-next-app)\b/.test(c)
      || /\b(npm|yarn|pnpm|npx|pip|pip3|pip2|gem|bundle|composer|conda|bower|cargo|rustup)\b/.test(c)
      || /\bgo\s+(install|build|get)\b/.test(c)
      || /\b(mvn|mvnw|gradle|ant|sbt)\b/.test(c)
      || /\b(dnf|yum|apt|apt-get|apt-cache|pacman|zypper|emerge|apk|brew|port|snap|flatpak)\s+(install|update|upgrade|remove|search)/.test(c)
      || /\bdocker\s+(pull|build|push|run)\b/.test(c)
      || /\bwget\b/.test(c)
      || /\bcurl\s+.+(-[oO]|--output|--download-dir)/.test(c)
      || /\bgit\s+clone\b/.test(c)
      || /\btar\s+.*-[xjzJp]/.test(c)
      || /\bunzip\b/.test(c)
      || /\.\/(configure|bootstrap|autogen\.sh)\b/.test(c) // autoconf configure step
      || /\bautoreconf\b/.test(c);                         // autoconf regeneration
  };

  const isCompilationCommand = (cmd) => {
    const c = String(cmd || '').toLowerCase();
    return /\bcargo\s+(build|install|test|check)\b/.test(c)
      || /\bmake\b/.test(c)
      || /\bcmake\b/.test(c)
      || /\bgcc\b/.test(c)
      || /\bg\+\+\b/.test(c)
      || /\brustc\b/.test(c)
      || /\bmvn\b/.test(c)
      || /\bgradle\b/.test(c)
      || /\bninja\b/.test(c)
      || /\bmeson\b/.test(c)
      || /\bbazel\s+(build|run|test)\b/.test(c);
  };

  const hasActiveCompilationOutput = (text) => {
    const raw = String(text || '');
    return /^\s*(Compiling|Linking|Building\s*\[)\b/im.test(raw)
      || /^\s*(Finished|Running|Checking|warning:|error\[E)\b/im.test(raw)
      || /\bmake\[\d+\]/i.test(raw)
      || /\d+\/\d+:\s*\w/i.test(raw)
      || /^\s*\[\d+\/\d+\]\s+/m.test(raw)
      || /^\s*ninja:\s+/im.test(raw)
      || /^\s*\[\s*\d+%\]\s+/m.test(raw);
  };

  // Detect Docker image pull/download in progress - FULLY DYNAMIC
  const hasActiveDockerPull = (text) => {
    const raw = String(text || '');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) return false;
    
    const lastLine = (lines[lines.length - 1] || '').trim();
    const lastLineLower = lastLine.toLowerCase();
    
    // === COMPLETION DETECTION ===
    // These patterns indicate the pull is 100% DONE
    const completionPatterns = [
      /status:\s*downloaded\s+newer\s+image/i,
      /status:\s*image\s+is\s+up\s+to\s+date/i,
      /status:\s*downloaded\s+newer/i,
      /digest:\s*sha256:[a-f0-9]{12,}/i,
      /^docker\.io\/[\w\/-]+@sha256:/i,  // Final image reference
    ];
    
    // Check if last line indicates completion
    if (completionPatterns.some(p => p.test(lastLine))) return false;
    if (/pull\s*complete/i.test(lastLine)) return false;
    if (/status:\s*downloaded/i.test(lastLineLower)) return false;
    
    // Check for shell prompt after completion (definitive done)
    if (looksLikeShellPrompt(raw)) return false;
    
    // === ACTIVE DOWNLOAD DETECTION ===
    // Count active vs idle indicators
    let activeSignals = 0;
    let idleSignals = 0;
    
    // Check last 5 lines for activity
    const recentLines = lines.slice(-5);
    for (const line of recentLines) {
      const lineLower = line.toLowerCase();
      
      // Active download indicators
      if (/pulling from/i.test(line)) activeSignals++;
      if (/downloading\b/i.test(line)) activeSignals++;
      if (/extracting\b/i.test(line)) activeSignals++;
      if (/^\s*\[\d+\/\d+\]/.test(line)) activeSignals++;
      if (/^\s*\d+%/.test(line)) activeSignals++;
      if (/get:\d+\s+http/i.test(line)) activeSignals++;
      if (/fetched\s+\d+\s*kb/i.test(line)) activeSignals++;
      if (/creating\s+container/i.test(line)) activeSignals++;
      if (/starting\s+container/i.test(line)) activeSignals++;
      
      // Idle/completion indicators
      if (/pull\s*complete/i.test(line)) idleSignals++;
      if (/status:\s*downloaded/i.test(line)) idleSignals++;
      if (/digest:\s*sha256:/i.test(line)) idleSignals++;
    }
    
    // If more idle signals than active, consider done
    if (idleSignals > activeSignals) return false;
    
    // If we have active signals and no completion, still running
    if (activeSignals > 0 && idleSignals === 0) return true;
    
    // === ADAPTIVE TIMING CHECK ===
    // Use the adaptive wait system to determine if we should wait longer
    const state = adaptiveWaitRef.current;
    const timeSinceOutput = Date.now() - (lastOutputAtRef.current || 0);
    
    // If output is recent (< 1s), likely still active
    if (timeSinceOutput < 1000 && activeSignals > 0) return true;
    
    // If we've been waiting a long time with no new output, likely done
    const avgWait = state?.avgCommandTime || 3;
    if (timeSinceOutput > avgWait * 2000 && activeSignals === 0) return false;
    
    // Default: check if terminal has prompt
    return !looksLikeShellPrompt(raw);
  };

  // Combined check for any active download/build process
  const hasActiveDownloadOrBuild = (text) => {
    return hasActiveCompilationOutput(text) || hasActiveDockerPull(text);
  };

  const looksLikeShellPrompt = (text) => {
    // Strip ANSI escape codes and non-printable characters first
    const cleanText = String(text || '')
      .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
      .replace(/[^\x20-\x7E❯➜➔➤\n\r]/g, '');
    const lines = cleanText.split('\n').filter(l => l.trim().length > 0);
    const last = (lines[lines.length - 1] || '').trim();
    if (!last) return false;

    // Exclude REPL prompts that look like shell prompts but aren't:
    // Python REPL: '>>>' or '...' continuation; IPython/Jupyter: 'In [n]:'
    if (/^>{3,}\s*$/.test(last)) return false;   // Python/Ruby >>> REPL
    if (/^\.{3}\s*$/.test(last)) return false;   // Python ... continuation
    if (/^In\s*\[\d*\]:\s*$/.test(last)) return false; // IPython/Jupyter In [n]:
    if (/^\(Pdb\+?\)\s*$/.test(last)) return false;    // Python debugger (Pdb)

    // Common standard prompts: $, #, %, > and rich zsh themes: ❯, ➜, ➔, ➤
    if (/[$#%>❯➜➔➤]\s*$/.test(last)) return true;
    // Brackets/paths style: [user@server ~]# or (base) user@host ~/path $
    // This also captures [user@host ~]$ (even without space)
    if (/\]\s*[$#%>❯➜➔➤]\s*$/.test(last) || /\)\s*.*[$#%>❯➜➔➤]\s*$/.test(last) || /\][$#%>]/.test(last)) return true;
    // bash/sh/zsh/fish version prompts: bash-5.1$
    if (/^(bash|sh|zsh|fish|cmd)-[\d.]+[$#%>]\s*$/.test(last)) return true;
    // user@host pattern: check for common user@host indicators (e.g. [user@host ~]$ or user@host:path$)
    if (/^\[?[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+.*[$#%>❯➜➔➤]\s*$/.test(last)) return true;
    if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\s*[:\s]\s*[~/\\w.-]+\s*$/.test(last) && last.length < 100) return true;
    return false;
  };

  const looksLikeEditorOrPager = (text) => {
    const raw = String(text || '');
    // If we have a shell prompt, we are NOT in a pager/editor (it finished or exited)
    if (looksLikeShellPrompt(raw)) return null;
    const t = raw.toLowerCase();
    // nano editor indicators
    if (t.includes('gnu nano') || t.includes('^g get help') || t.includes('^x exit')) return 'nano';
    // vim/vi indicators — INSERT mode, visual mode, or vim status line (e.g. "0,0-1All", "1,1All")
    if (t.includes('-- insert --') || t.includes('-- visual --') || t.includes('-- normal --')) return 'vim';
    // vim status bar: "0,0-1All", "1,1  All", "Top", "Bot", "All" at end of line preceded by row/col
    if (/\d+,\d+[-\s]*(?:all|top|bot|\d+%)\s*$/im.test(raw)) return 'vim';
    // multiple ~ lines (vim empty buffer indicator)
    if ((raw.match(/^~$/gm) || []).length >= 3) return 'vim';
    // less/more pager
    if (t.includes('(end)')) return 'pager';
    if (/\blines\s+\d+[-\d]*\/\d+\s*\(end\)\b/i.test(t)) return 'pager';
    // systemctl/journalctl pager screens
    if (/\n~\n/.test(t) && (t.includes('press return') || t.includes('press enter') || t.includes('press q') || t.includes('press any key'))) return 'pager';
    // "press RETURN" style pagers
    if (/press return/i.test(t) || /press enter/i.test(t) || /log file support is not available/i.test(t) || t.includes('press return')) return 'pager';
    // colon-prompt at end of last line (less pager waiting for input)
    // colon-prompt at end of last line (less pager waiting for input)
    if (/^:\s*$/m.test(raw.split('\n').slice(-3).join('\n'))) return 'pager';
    // systemctl status / more / less indicators
    if (t.includes('lines ') && t.includes('--more--')) return 'pager';
    if (t.includes('(end)') || t.includes('press q to quit')) return 'pager';
    // man page
    if (t.includes('manual page') || t.includes('man page')) return 'man';
    return null;
  };

  // Detect streaming/blocked commands that never exit on their own (pm2 log, tail -f, journalctl -f, etc.)
  const isStreamingCommand = (cmd) => {
    const c = String(cmd || '').toLowerCase().trim();
    // Commands that stream output indefinitely until interrupted
    const streamingPatterns = [
      /\bpm2\s+(log|logs|monit|mon)\b/,           // pm2 log, pm2 logs, pm2 monit
      /\btail\s+(-f|--follow)/,                     // tail -f, tail --follow
      /\bjournalctl\s+(-f|--follow)/,              // journalctl -f
      /\b(kubectl|k)\s+logs\s+.*(-f|--follow)/,    // kubectl logs -f
      /\bdocker\s+logs\s+.*(-f|--follow)/,        // docker logs -f
      /\bless\s+/,                                 // less (can be interactive)
      /\bmore\s+/,                                 // more (can be interactive)
      /\bwatch\s+/,                                // watch command
      /\btop\b/,                                   // top
      /\bhtop\b/,                                  // htop
      /\bnc\s+.*(-l|--listen)/,                   // netcat listening
      /\bcat\s+.*\|/,                              // cat piped (might be waiting)
      /\bgrep\s+.*--line-buffered/,                // grep with line buffering
      /\bscreen\s+/,                               // screen
      /\btmux\s+/,                                 // tmux
      /\bredis-cli\s+monitor/,                     // redis-cli monitor
      /\bmysql\s+.*-e\s+"/,                        // mysql with query (might hang)
      /\bping\s+/,                                 // ping (runs until stopped)
      /\btraceroute\s+/,                           // traceroute
      /\bnslookup\s+/,                             // nslookup interactive
      /\bpython\s+(-i|--interactive)/,             // python interactive
      /\bnode\s+(-i|--interactive)/,              // node interactive
      /\birb\b/,                                   // ruby interactive
      /\bphp\s+-a/,                                // php interactive
      /^(python|python3|python2|pypy3?)\s*$/,      // bare Python REPL (no script arg)
      /^(node|nodejs)\s*$/,                        // bare Node.js REPL
      /^(ruby)\s*$/,                               // bare Ruby REPL
      /^(lua)\s*$/,                                // Lua REPL
      /^(sqlite3)\s*$/,                            // SQLite interactive (no DB arg)
      /^(mysql|mariadb)\b(?!.*\s-e\s)/,           // MySQL interactive shell
      /^(psql)\b(?!.*\s-c\s)/,                    // PostgreSQL interactive shell
      /^(redis-cli)\b(?!.*\s--scan\b)(?!.*\smonitor\b)/, // Redis interactive shell
      /^(mongo|mongosh)\b/,                        // Mongo shell
      /\bsqlite3\s+/,                              // sqlite3 interactive
    ];
    return streamingPatterns.some(p => p.test(c));
  };

  // Detect if terminal is in a streaming state (no prompt, output keeps coming)
  const looksLikeStreamingMode = (text, lastCmd) => {
    const raw = String(text || '');
    // If we have a shell prompt, we're not streaming
    if (looksLikeShellPrompt(raw)) return null;
    
    const t = raw.toLowerCase();
    const cmdLower = String(lastCmd || '').toLowerCase();
    
    // Check if the last command was a streaming command
    if (!isStreamingCommand(cmdLower)) return null;
    
    // Detect streaming indicators in output
    const streamingIndicators = [
      // PM2 log/streaming indicators
      /[\[<]\d{4}-\d{2}-\d{2}/,                    // timestamp prefix in logs
      /pm2\s+(log|logs|monit)/i,
      /\[pm2\]/i,
      // General log streaming patterns
      /streaming\.{3,}/i,
      /listening\.{3,}/i,
      /waiting\.{3,}/i,
      // tail -f patterns
      /==>\s*\S+\s+<==/i,                        // tail -f file header
      // journalctl -f
      /--\s*beginning\s+/i,
      // top/htop
      /cpu\s+\d+%/i,
      /mem\s*:/i,
      // watch
      /every\s+\d+\.?\d*\s*s/i,
      // ping
      /\d+\s*bytes\s+from/i,
      /ttl=\d+/i,
      // time elapsed indicators (command still running)
      /time\s+\d+:\d+/i,
    ];
    
    // If we see streaming indicators and no prompt, it's streaming
    const hasStreamingIndicator = streamingIndicators.some(p => p.test(t));
    if (hasStreamingIndicator) return 'streaming';
    
    // If the command is a known streaming command and we have output but no prompt
    // and the output is actively changing (checked by caller via idleFor), treat as streaming
    if (isStreamingCommand(cmdLower)) return 'streaming';
    
    return null;
  };

  const waitForCommandSettle = async (commandHint) => {
    const maxMs = 300000; // 5 minute max heartbeat (safety net)
    const cmdLower = String(commandHint || '').toLowerCase();

    // Speed optimizations: reduce idle wait for normal commands
    let idleMs = 600; 
    let stuckMs = 20000;
    
    // Use shared isHeavyCommand helper (defined above)
    const isHeavy = isHeavyCommand(cmdLower);
    if (isHeavy) {
      idleMs = 4000; // Give installers more time to think
      stuckMs = 180000; // 3 minutes — package downloads/extractions can be silent for a long time
    }

    // Compilation commands: cargo build, make, cmake, gcc, g++, rustc, mvn, gradle
    // These can go completely silent for MINUTES during linking — never declare stuck during active compile
    const isCompilationCmd = isCompilationCommand(cmdLower);
    if (isCompilationCmd) {
      idleMs = 4000;
      stuckMs = 600000; // 10 min — prompt detection will exit early when shell prompt appears
    }
    
    // Minimal override just to prevent flickering on very quick commands
    if (/^\[?ctrl\+c\]?$|^\^c$/.test(cmdLower)) {
      idleMs = 200;
    }

    // [Wait] inherits the timeout of the last real command so it doesn't time out too early
    if (/^\[wait\]$/i.test(cmdLower)) {
      const lastCmd = String(lastCommandSentAtRef._lastRealCmd || '');
      const lastIsHeavy = isHeavyCommand(lastCmd);
      if (lastIsHeavy) {
        idleMs = 4000;
        stuckMs = 180000;
      } else {
        idleMs = 2000;
        stuckMs = 60000; // 1 minute wait before giving up on [Wait]
      }
    }

    const start = Date.now();
    let lastCheckSnap = '';
    // Tracks whether ANY compilation output (Compiling/Linking/Building) has appeared.
    // Once true we require a longer idle before accepting a shell prompt, and we never
    // return 'prompt' while active compilation markers are still the most recent output.
    let compilationStarted = false;
    // Regex for "compilation is actively in progress" (excludes Finished/warning/error which can coexist with a prompt)
    const compilingActiveRe = /^\s*(Compiling|Linking|Building\s*\[)\b/im;

    while (Date.now() - start < maxMs) {
      const snap = getOutputContext();

      // Track if compilation has ever started for this command
      if (isCompilationCmd && !compilationStarted && compilingActiveRe.test(snap)) {
        compilationStarted = true;
      }

      // 1. Check for shell prompt FIRST (if prompt is ready, we are NOT in an editor/pager)
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      // For compilation commands: once compilation has started, require 3 s of idle AND
      // verify compilation is no longer the last meaningful output. This prevents the AI
      // from being called while cargo/make is still linking (which can be silent for minutes).
      const promptIdleMs = compilationStarted ? 3000 : Math.min(idleMs, 800);
      if (idleFor > promptIdleMs && looksLikeShellPrompt(snap) && sawOutputAfterCommandRef.current) {
        // Extra guard for compilation: don't return prompt if the recent output still shows
        // active compilation markers (handles race between linker silence and prompt detection)
        if (compilationStarted && compilingActiveRe.test(snap.split('\n').slice(-6).join('\n'))) {
          // Still compiling — don't return yet, let the loop continue
        } else {
          return { reason: 'prompt', snap };
        }
      }

      // 2. Check for editor/pager (these never "settle" — output stops but we're stuck)
      const editorPager = looksLikeEditorOrPager(snap);
      // Pagers (less/more/man) block immediately — detect them fast (500ms) so they aren't
      // misclassified as interactive/press_enter by the check below.
      // True editors (vim/nano) need a longer grace period (1200ms) to distinguish from normal output.
      const pagerQuickSet = new Set(['pager', 'man']);
      const editorIdleMs = (editorPager && pagerQuickSet.has(editorPager)) ? 500 : 1200;
      if (editorPager && idleFor > editorIdleMs) return { reason: 'editor', snap, editor: editorPager };

      // 2.5. Check for streaming/blocked commands (pm2 log, tail -f, etc.)
      const streaming = looksLikeStreamingMode(snap, commandHint);
      const timeSinceCmd = Date.now() - start;
      if (streaming && (idleFor > 2000 || timeSinceCmd > 5000)) return { reason: 'streaming', snap, streaming };

      // 3. Check for errors (patience: don't error out while output is still flying)
      const err = detectTerminalError(snap);
      if (err && idleFor > 3000) return { reason: 'error', snap, error: err };

      // 4. Check for interactive prompt
      const interactive = detectInteractivePrompt(snap);
      if (interactive) return { reason: 'interactive', snap, interactive };

      // Detect stuck (no output change for a long time, but no prompt)
      if (idleFor > stuckMs && snap === lastCheckSnap) {
        return { reason: 'stuck', snap };
      }

      // Compilation guard: if the terminal shows active compilation progress (Compiling/Linking/Building/make),
      // keep the stuck timer from firing by continuously refreshing lastCheckSnap.
      // This prevents declaring 'stuck' during the silent linking phase of cargo/make/gcc.
      const isActivelyCompiling = hasActiveCompilationOutput(snap);
      if (isActivelyCompiling) {
        lastCheckSnap = snap; // Reset stuck timer — build is alive, just silent during linking
      }

      lastCheckSnap = snap;
      await new Promise(r => setTimeout(r, 100)); // Faster polling (100ms)
    }

    return { reason: 'busy', snap: getOutputContext() };
  };

  const detectInteractivePrompt = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;

    // 🧪 ROBUSTNESS: If a shell prompt is detected, any interactive prompt is already handled
    // and is just part of the scrollback history. Do not re-trigger recovery.
    if (looksLikeShellPrompt(raw)) return null;

    const t = raw.toLowerCase();
    const nonEmptyLines = raw.split('\n').map(l => String(l || '')).filter(l => l.trim().length > 0);
    const lastFew = nonEmptyLines.slice(-6);
    const lastLine = (lastFew[lastFew.length - 1] || '').trim();
    const lastLineLower = lastLine.toLowerCase();
    const tailText = lastFew.join('\n');
    const tailTextLower = tailText.toLowerCase();

    // === Y/N Confirmation Prompts ===
    // yum/dnf/apt confirmation
    if (/(\(y\/n\)|\[y\/n\]|\[y\/n\/d\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\[yes\/no\]|\(y\)\s*$|\[y\]\s*$)/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    if (/(\(y\)|\[y\])/i.test(lastLine) && /(proceed|confirm|continue|ok to)/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    if (/proceed/i.test(tailTextLower) && /(\?\s*\(y\))|(\(y\)\s*[:：]?\s*$)/i.test(tailTextLower)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    // Match "is this ok" ONLY if it's recent (at the very end of tail)
    if (/is this ok/i.test(tailTextLower) && /\[y/i.test(tailTextLower)) {
      const idx = tailTextLower.lastIndexOf('is this ok');
      if (idx !== -1 && tailTextLower.length - idx < 120) {
        return { kind: 'confirm_yn', text: lastLine };
      }
    }
    // apt "Do you want to continue?"
    if (/do you want to continue/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    // GPG Key Import
    if (/importing.*gpg key/i.test(tailTextLower) && /is this ok/i.test(tailTextLower)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    // Generic confirmations ending with ? and containing yes/no words
    if (/\?\s*$/.test(lastLine) && /(proceed|continue|confirm|accept|agree|overwrite|replace|remove|delete)/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }

    // === Overwrite Prompts ===
    if (/overwrite\s+.*\?/i.test(lastLine) || /already exists.*overwrite/i.test(tailTextLower)) {
      return { kind: 'confirm_overwrite', text: lastLine };
    }
    if (/file exists.*replace/i.test(lastLine)) {
      return { kind: 'confirm_overwrite', text: lastLine };
    }

    // === Password/Passphrase Prompts ===
    if (/password\s*[:：]\s*$/i.test(lastLine) || /password for/i.test(lastLine)) {
      return { kind: 'password', text: lastLine };
    }
    if (/passphrase/i.test(lastLine) && /[:：]\s*$/.test(lastLine)) {
      return { kind: 'passphrase', text: lastLine };
    }
    if (/enter.*password/i.test(lastLine) || /new password/i.test(lastLine)) {
      return { kind: 'password', text: lastLine };
    }
    if (/enter passphrase for key/i.test(lastLine) || /enter same passphrase again/i.test(lastLine)) {
      return { kind: 'passphrase', text: lastLine };
    }
    if (/^[^\n]{0,120}'s password\s*[:：]?\s*$/i.test(lastLine)) {
      return { kind: 'password', text: lastLine };
    }
    if (/password for user\s+\S+\s*[:：]?\s*$/i.test(lastLine) || /enter password\s*[:：]?\s*$/i.test(lastLine)) {
      return { kind: 'password', text: lastLine };
    }
    if (/(password|passphrase).*[:：]\s*$/i.test(tailTextLower)) {
      const line = (lastFew.find(l => /(password|passphrase).*[:：]\s*$/i.test(l)) || lastLine).trim();
      return /passphrase/i.test(line) ? { kind: 'passphrase', text: line } : { kind: 'password', text: line };
    }

    // === sudo password prompt ===
    if (/\[sudo\]\s+password/i.test(lastLine)) {
      return { kind: 'sudo_password', text: lastLine };
    }

    // === Press ENTER / Any Key ===
    if (/press.*enter/i.test(lastLine) || /press.*return/i.test(lastLine) || /press any key/i.test(lastLine)) {
      return { kind: 'press_enter', text: lastLine };
    }
    if (/press.*enter/i.test(tailTextLower) || /press.*return/i.test(tailTextLower) || /press any key/i.test(tailTextLower)) {
      const idx = tailTextLower.lastIndexOf('press');
      if (idx !== -1 && tailTextLower.length - idx < 120) {
        const line = (lastFew.find(l => /press.*(enter|return)/i.test(l) || /press any key/i.test(l)) || lastLine).trim();
        return { kind: 'press_enter', text: line };
      }
    }
    if (/hit enter/i.test(lastLine) || /press.*to continue/i.test(lastLine)) {
      return { kind: 'press_enter', text: lastLine };
    }

    // === SSH Key Prompts ===
    if (/enter file in which to save/i.test(lastLine)) {
      return { kind: 'ssh_key_file', text: lastLine };
    }
    if (/are you sure you want to continue connecting/i.test(tailTextLower)) {
      return { kind: 'ssh_host_verify', text: lastLine };
    }

    // === Selection Prompts ===
    if (/select.*\[\d/i.test(lastLine) || /choose.*\[\d/i.test(lastLine) || /option.*\[\d/i.test(lastLine)) {
      return { kind: 'selection', text: lastLine };
    }
    if (/\[\d+[-/]\d+\]\s*[:：]?\s*$/i.test(lastLine)) {
      return { kind: 'selection', text: lastLine };
    }
    if (/select.*disk/i.test(lastLine) || /which.*partition/i.test(lastLine)) {
      return { kind: 'selection', text: lastLine };
    }

    // === Generic "input required" ===
    if (/[:：]\s*$/.test(lastLine)) {
      if (/\?\s*[:：]\s*$/i.test(lastLine) || /enter\s/i.test(lastLineLower) || /type\s/i.test(lastLineLower) || /provide\s/i.test(lastLineLower) || /specify\s/i.test(lastLineLower) || /write\s*[:：]\s*$/i.test(lastLineLower)) {
        return { kind: 'text_input', text: lastLine };
      }
    }

    return null;
  };

  const sendQuickInput = (value) => {
    const v = String(value || '').replace(/[\r\n]+$/g, '');
    if (!v) return;
    if (socketRef.current?.connected) {
      socketRef.current.emit('ssh:input', `${v}\n`);
      termInstanceRef.current?.focus();
      return;
    }
    termInstanceRef.current?.focus();
  };

  const showAiDoneModal = ({ goal, steps = [], taskMode = 'ssh', thought = null, explain = null } = {}) => {
    console.log('[AI Agent] SUCCESS: Triggering Completion Modal', { goal, stepsCount: steps?.length });
    
    // Safety: Reset error and stop engine
    setAiError(null);
    setAutoMode(false);
    autoModeRef.current = false; 
    autoRunningRef.current = false; 

    // Prepare summary data
    setAiDoneSummary({
      goal: goal || autoGoal || aiPrompt || 'Task complete',
      steps: (Array.isArray(steps) ? steps : []).slice(-20),
      taskMode: taskMode || sshAiPrefs?.aiTask || 'ssh',
      thought: thought || null,
      explain: explain || null,
      mode: aiMode, // NEW: Track which mode this summary belongs to
    });

    // Pulse the state to ensure visibility
    setAiOpen(true);
    setAiHasOpenedOnce(true);
    setAiDone(aiMode); // Changed true -> aiMode

    // Forced pulses to overcome React batching/dropped updates
    setTimeout(() => setAiDone(aiMode), 50);
    setTimeout(() => setAiDone(aiMode), 250);
    
    setTimeout(() => {
      termInstanceRef.current?.focus();
    }, 500);
  };

  const normalizeAiTerminalCommand = (command) => {
    let normalized = String(command || '').trim();
    if (!normalized) return normalized;

    if (autoMode && /^sudo\b/.test(normalized) && !/^sudo\s+-[^\n]*\bn\b/.test(normalized)) {
      normalized = normalized.replace(/^sudo\b\s*/, 'sudo -n ');
    }

    if (/\btmux\s+send-keys\b/.test(normalized) && /-t\s+ai-bg-task(?=\s|$|["'])/.test(normalized)) {
      normalized = normalized.replace(/\btmux\s+send-keys\b\s+-t\s+ai-bg-task(?=\s|$|["'])/, 'tmux has-session -t ai-bg-task 2>/dev/null || tmux new-session -d -s ai-bg-task; tmux send-keys -t ai-bg-task:0.0');
    }

    if (/^(?:sudo\s+)?systemctl\s+status\b/.test(normalized) && !/\s--no-pager\b/.test(normalized)) {
      normalized += ' --no-pager';
    }
    if (/^(?:sudo\s+)?journalctl\b/.test(normalized) && !/\s--no-pager\b/.test(normalized)) {
      normalized += ' --no-pager';
    }

    return normalized;
  };

  const isStdinBlockingCommand = (cmd) => {
    const c = String(cmd || '').trim().toLowerCase();
    if (!c) return false;
    return /^cat\s*$/.test(c)
      || /^cat\s*(>|>>)\s*\S+/.test(c)
      || /^tee(?:\s+-a)?(?:\s+\S+)+\s*$/.test(c);
  };

  const isInteractiveReplCommand = (cmd) => {
    const c = String(cmd || '').trim().toLowerCase();
    if (!c) return false;
    return /^(python|python3|python2|pypy3?|node|nodejs|ruby|lua|sqlite3)\s*$/.test(c)
      || /^(mysql|mariadb)\b(?!.*\s-e\s)/.test(c)
      || /^(psql)\b(?!.*\s-c\s)/.test(c)
      || /^(redis-cli)\b(?!.*\s--scan\b)(?!.*\smonitor\b)/.test(c)
      || /^(mongo|mongosh)\b/.test(c);
  };

  const tryAutoRecoverBlockedTerminal = async (snapshotOverride, commandOverride) => {
    if (!socketRef.current?.connected) return null;

    let snap = String(snapshotOverride ?? getOutputContext() ?? '');
    if (!snap || looksLikeShellPrompt(snap)) return null;

    const editorType = looksLikeEditorOrPager(snap);
    const lastCmd = String(commandOverride ?? lastExecutedCommand ?? '').trim();
    const lowerCmd = lastCmd.toLowerCase();
    let attempted = false;

    if (editorType === 'vim') {
      attempted = true;
      socketRef.current.emit('ssh:input', '\x1b');
      await new Promise(r => setTimeout(r, 120));
      socketRef.current.emit('ssh:input', ':q!\n');
      await new Promise(r => setTimeout(r, 700));
      snap = getOutputContext();

      if (!looksLikeShellPrompt(snap) && looksLikeEditorOrPager(snap) === 'vim') {
        socketRef.current.emit('ssh:input', '\x1b');
        await new Promise(r => setTimeout(r, 120));
        socketRef.current.emit('ssh:input', ':qa!\n');
        await new Promise(r => setTimeout(r, 700));
        snap = getOutputContext();
      }
    } else if (editorType === 'nano') {
      attempted = true;
      socketRef.current.emit('ssh:input', '\x18'); // Ctrl+X
      await new Promise(r => setTimeout(r, 350));
      snap = getOutputContext();

      if (/save\s+(this\s+)?modified\s+buffer|save\s+buffer|modified buffer/i.test(snap)) {
        socketRef.current.emit('ssh:input', 'n\n');
        await new Promise(r => setTimeout(r, 700));
        snap = getOutputContext();
      }
    } else if (isStdinBlockingCommand(lowerCmd) || isInteractiveReplCommand(lowerCmd)) {
      attempted = true;
      socketRef.current.emit('ssh:input', '\x03'); // Ctrl+C
      await new Promise(r => setTimeout(r, 700));
      snap = getOutputContext();
    }

    if (!attempted) return null;

    setLastResultSnapshot(snap);
    if (looksLikeShellPrompt(snap)) {
      setLastResultAt((prev) => {
        const next = Date.now();
        const p = Number(prev || 0);
        return next > p ? next : p + 1;
      });
    }
    maybeHandleInteractivePrompt(snap);
    return snap;
  };

  const detectTerminalError = (text) => {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return null;

    // Get the last few lines for more accurate detection (avoid false positives from old output)
    // Increased to 40 lines to catch errors pushed up by 'find', 'ls', or discovery commands
    const recentLines = t.split('\n').filter(Boolean).slice(-40).join('\n');

    // === Command Not Found ===
    if (recentLines.includes('command not found')) return { type: 'command_not_found', label: 'Command not found', severity: 'high' };
    if (recentLines.includes('not recognized as an internal or external command')) return { type: 'command_not_found', label: 'Command not found', severity: 'high' };
    if (/no such command/i.test(recentLines)) return { type: 'command_not_found', label: 'No such command', severity: 'high' };

    // === Permission / Access ===
    if (recentLines.includes('permission denied')) return { type: 'permission_denied', label: 'Permission denied', severity: 'high' };
    if (recentLines.includes('access denied')) return { type: 'permission_denied', label: 'Access denied', severity: 'high' };
    if (recentLines.includes('operation not permitted')) return { type: 'permission_denied', label: 'Operation not permitted', severity: 'high' };
    if (/insufficient privileges/i.test(recentLines)) return { type: 'permission_denied', label: 'Insufficient privileges', severity: 'high' };

    // === File/Path Errors ===
    if (recentLines.includes('no such file or directory')) return { type: 'missing_file', label: 'No such file or directory', severity: 'high' };
    if (recentLines.includes('is a directory')) return { type: 'wrong_type', label: 'Is a directory', severity: 'medium' };
    if (recentLines.includes('not a directory')) return { type: 'wrong_type', label: 'Not a directory', severity: 'medium' };
    if (recentLines.includes('file exists')) return { type: 'file_exists', label: 'File already exists', severity: 'medium' };

    // === Package Manager Errors ===
    if (/no match for/i.test(recentLines) || /no package.*found/i.test(recentLines)) return { type: 'package_not_found', label: 'Package not found', severity: 'high' };
    if (/unable to locate package/i.test(recentLines)) return { type: 'package_not_found', label: 'Package not found', severity: 'high' };
    if (/nothing provides/i.test(recentLines)) return { type: 'dependency_error', label: 'Missing dependency', severity: 'high' };
    if (/dependency.*conflict/i.test(recentLines) || /conflicts with/i.test(recentLines)) return { type: 'dependency_error', label: 'Dependency conflict', severity: 'high' };
    if (/broken packages/i.test(recentLines)) return { type: 'dependency_error', label: 'Broken packages', severity: 'high' };
    if (/repository.*not found/i.test(recentLines) || /cannot find.*repo/i.test(recentLines)) return { type: 'repo_error', label: 'Repository error', severity: 'medium' };

    // === Docker / Container Errors ===
    if (/docker[:\s]/.test(t) && (/no such container/i.test(t) || /not running/i.test(t) || /failed to start/i.test(t))) return { type: 'docker_error', label: 'Docker error', severity: 'high' };
    if (/failed to solve:/i.test(recentLines) || /process.*did not complete successfully: exit code:/i.test(recentLines)) return { type: 'docker_error', label: 'Docker build failed', severity: 'critical' };
    if (/kubernetes|kubectl/.test(t) && (/not found/i.test(t) || /error from server/i.test(t) || /refused/i.test(t))) return { type: 'k8s_error', label: 'Kubernetes error', severity: 'high' };

    // === Database Errors ===
    if (/mysql|postgresql|psql|redis|mongo/.test(t) && (/connection refused/i.test(t) || /access denied/i.test(t) || /fatal[:\s]/.test(t))) return { type: 'db_error', label: 'Database connection failed', severity: 'high' };

    // === Resource / Disk Errors ===
    if (/disk quota exceeded/i.test(recentLines)) return { type: 'disk_full', label: 'Disk quota exceeded', severity: 'critical' };
    if (/argument list too long/i.test(recentLines)) return { type: 'system_error', label: 'Argument list too long', severity: 'high' };

    // === Connection / Network Errors ===
    if (/connection refused/i.test(recentLines)) return { type: 'connection_refused', label: 'Connection refused', severity: 'high' };
    if (/connection timed out/i.test(recentLines) || /timed out/i.test(recentLines)) return { type: 'timeout', label: 'Connection timed out', severity: 'high' };
    if (/name or service not known/i.test(recentLines) || /could not resolve/i.test(recentLines)) return { type: 'dns_error', label: 'DNS resolution failed', severity: 'high' };
    if (/network.*unreachable/i.test(recentLines)) return { type: 'network_error', label: 'Network unreachable', severity: 'high' };

    // === Service Errors ===
    if (/failed to start/i.test(recentLines)) return { type: 'service_error', label: 'Service failed to start', severity: 'high' };
    if (/control process exited with error code/i.test(recentLines)) return { type: 'service_error', label: 'Service control process failed', severity: 'high' };
    if (/job for .* failed/i.test(recentLines)) return { type: 'service_error', label: 'Systemctl job failed', severity: 'high' };
    if (/start-pre.*failed|start-post.*failed|exec.*code=exited.*status/i.test(recentLines)) return { type: 'service_error', label: 'Service process failed', severity: 'high' };
    if (/unit.*not found/i.test(recentLines)) return { type: 'service_not_found', label: 'Service unit not found', severity: 'high' };
    if (/inactive \(dead\)/i.test(recentLines)) return { type: 'service_inactive', label: 'Service is inactive', severity: 'medium' };

    // === Disk/Resource Errors ===
    if (/no space left/i.test(recentLines)) return { type: 'disk_full', label: 'No space left on device', severity: 'critical' };
    if (/cannot allocate memory/i.test(recentLines)) return { type: 'memory_error', label: 'Out of memory', severity: 'critical' };
    if (/too many open files/i.test(recentLines)) return { type: 'resource_error', label: 'Too many open files', severity: 'high' };
    if (/version.*GLIBC.*not found/i.test(recentLines) || /GLIBC_[0-9].*not found/i.test(recentLines)) return { type: 'glibc_mismatch', label: 'GLIBC version mismatch (binary incompatible)', severity: 'critical' };

    // === Authentication Errors ===
    if (/authentication failure/i.test(recentLines) || /auth.*fail/i.test(recentLines)) return { type: 'auth_error', label: 'Authentication failure', severity: 'high' };
    if (/incorrect password/i.test(recentLines)) return { type: 'auth_error', label: 'Incorrect password', severity: 'high' };

    // === Port Errors ===
    if (/address already in use/i.test(recentLines) || /port.*already in use/i.test(recentLines)) return { type: 'port_in_use', label: 'Port already in use', severity: 'high' };

    // === Config Errors ===
    if (/syntax error/i.test(recentLines) || /parse error/i.test(recentLines)) return { type: 'syntax_error', label: 'Syntax/parse error', severity: 'high' };
    if (/configuration.*test.*failed/i.test(recentLines) || /configtest.*failed/i.test(recentLines)) return { type: 'config_error', label: 'Config test failed', severity: 'high' };

    // === Generic (lower priority — checked last) ===
    if (/\berror[:!]/i.test(recentLines) && !recentLines.includes('error:')) return { type: 'generic_error', label: 'Error', severity: 'medium' };
    if (recentLines.includes('error:')) return { type: 'generic_error', label: 'Error', severity: 'medium' };
    if (recentLines.includes('fatal:')) return { type: 'fatal_error', label: 'Fatal error', severity: 'critical' };
    if (/^.*\bfailed\b.*$/m.test(recentLines) && !/\bsuccess/i.test(recentLines)) {
      if (!/\b0\s+failed\b/i.test(recentLines)) {
        return { type: 'generic_error', label: 'Command failed', severity: 'medium' };
      }
    }

    // === Repository / Scaffolding Errors ===
    if (/could not locate.*repository/i.test(recentLines)) return { type: 'repo_error', label: 'Repository not found', severity: 'high' };
    if (/could not determine executable/i.test(recentLines)) return { type: 'npm_error', label: 'NPM Executable error', severity: 'high' };
    if (/invalid character/i.test(recentLines) && /project name/i.test(recentLines)) return { type: 'config_error', label: 'Invalid project name', severity: 'medium' };

    return null;
  };

  // 🛡️ DEEP SCAN: Unlike detectTerminalError (which only checks last 20 lines),
  // this scans the FULL terminal output for critical errors that would make
  // a 'done=true' declaration invalid. Used as a veto gate everywhere.
  const deepScanTerminalErrors = (text, goal) => {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return null;
    const goalLower = String(goal || '').toLowerCase();

    // Critical patterns that ALWAYS invalidate completion (regardless of line position)
    const criticalPatterns = [
      { pattern: /version.*glibc.*not found/i, label: 'GLIBC version mismatch', type: 'glibc_mismatch' },
      { pattern: /glibc_[0-9].*not found/i, label: 'GLIBC version mismatch', type: 'glibc_mismatch' },
      { pattern: /docker.*permission denied/i, label: 'Docker permission denied', type: 'docker_permission' },
      { pattern: /permission denied.*docker/i, label: 'Docker permission denied', type: 'docker_permission' },
      { pattern: /could not find.*cargo\.toml/i, label: 'Cargo.toml not found', type: 'build_error' },
      { pattern: /cannot allocate memory/i, label: 'Out of memory', type: 'memory_error' },
      { pattern: /no space left on device/i, label: 'Disk full', type: 'disk_full' },
      { pattern: /killed.*oom/i, label: 'OOM killed', type: 'memory_error' },
    ];

    // Goal-specific patterns: if goal mentions docker, scan for docker errors anywhere
    if (goalLower.includes('docker')) {
      criticalPatterns.push(
        { pattern: /docker:.*permission denied/i, label: 'Docker permission denied', type: 'docker_permission' },
        { pattern: /dial unix.*docker\.sock.*permission denied/i, label: 'Docker socket permission denied', type: 'docker_permission' },
        { pattern: /cannot connect to the docker daemon/i, label: 'Docker daemon not running', type: 'docker_error' },
        { pattern: /failed to solve:.*did not complete successfully/i, label: 'Docker build failed', type: 'build_error' }
      );
    }

    for (const { pattern, label, type } of criticalPatterns) {
      if (pattern.test(t)) {
        return { type, label, severity: 'critical' };
      }
    }

    // Check if goal keywords appear near error keywords in the output
    const goalWords = goalLower.split(/\s+/).filter(w => w.length > 3);
    const errorIndicators = ['error', 'failed', 'not found', 'denied', 'fatal', 'cannot', 'unable'];
    for (const gw of goalWords) {
      if (t.includes(gw)) {
        // Find lines containing the goal word
        const lines = t.split('\n');
        for (const line of lines) {
          if (line.includes(gw) && errorIndicators.some(ei => line.includes(ei))) {
            return { type: 'goal_error', label: `Error related to "${gw}" found in output`, severity: 'high' };
          }
        }
      }
    }

    return null;
  };



  const maybeHandleInteractivePrompt = (snapshot) => {
    // Grace period: ignore prompts briefly after the user just resumed from a password
    if (Date.now() < suppressInteractiveUntilRef.current) {
      setInteractivePrompt(null);
      return;
    }
    const p = detectInteractivePrompt(snapshot);

    if (!p) {
      setInteractivePrompt(null);
      return;
    }

    // Auto-answer common confirmations only when in Auto mode.
    if (aiMode === 'auto') {
      const cmd = String(lastExecutedCommand || '').toLowerCase();
      const looksLikeInstall = /(yum|dnf|apt|apt-get|apk|pacman|pip|npm|npx|yarn|gem)\s+.*\b(install|upgrade|update|remove|create|setup|add)\b/.test(cmd) || /\b(install|create-next-app)\b/.test(cmd);

      // Auto-answer Y/N for install/update confirmations
      if (p.kind === 'confirm_yn' && looksLikeInstall) {
        setInteractivePrompt(null);
        sendQuickInput('y');
        return;
      }

      // Auto-answer GPG key imports with yes
      if (p.kind === 'confirm_yn' && /gpg/i.test(p.text)) {
        setInteractivePrompt(null);
        sendQuickInput('y');
        return;
      }

      // Auto-answer SSH host verification with yes
      if (p.kind === 'ssh_host_verify') {
        setInteractivePrompt(null);
        sendQuickInput('yes');
        return;
      }

      // Auto-answer defaults for text inputs in installers (e.g. create-next-app project name, npm init defaults)
      if ((p.kind === 'text_input' || p.kind === 'selection') && looksLikeInstall) {
        // Only if it looks like it has a [default] or just asking for a name
        if (p.text.includes('?') || p.text.includes('name') || p.text.includes('default')) {
           setInteractivePrompt(null);
           sendQuickInput(''); // Just press Enter for default
           return;
        }
      }

      // Auto-press ENTER for "press enter to continue" or SSH key file (accept default)
      if (p.kind === 'press_enter' || p.kind === 'ssh_key_file') {
        setInteractivePrompt(null);
        sendQuickInput('');
        // Need to send just a newline
        if (socketRef.current?.connected) {
          socketRef.current.emit('ssh:input', '\n');
        }
        return;
      }
    }

    // For prompts that require manual input, pause auto mode
    setInteractivePrompt(p);
    if (p && autoMode) {
      const pauseReasons = {
        'confirm_yn': 'interactive prompt requires input (y/n)',
        'confirm_overwrite': 'overwrite confirmation required',
        'password': 'password input required (cannot be automated)',
        'passphrase': 'passphrase input required',
        'sudo_password': 'sudo password prompt detected — trying passwordless (NOPASSWD)',
        'ssh_key_file': 'SSH key file path input required',
        'ssh_host_verify': 'SSH host verification required',
        'press_enter': 'waiting for ENTER key',
        'selection': 'selection input required',
        'text_input': 'text input required',
      };
      setAiError(`${t('ai.pausedPrompt')}`);
      setAutoMode(false);
      setAiOpen(true);
      setAiHasOpenedOnce(true);
    }
  };

  const refreshLastResultSnapshot = () => {
    const snap = getOutputContext();
    setLastResultSnapshot(snap);
    setLastResultAt((prev) => {
      const next = Date.now();
      const p = Number(prev || 0);
      return next > p ? next : p + 1;
    });

    maybeHandleInteractivePrompt(snap);
  };

  useEffect(() => {
    // Only attempt diff extraction in code-edit mode (keeps UI simpler for normal SSH mode)
    if (sshAiPrefs?.aiTask !== 'code') {
      setFileChanges(null);
      setSelectedDiffFile('');
      return;
    }
    const extracted = extractUnifiedDiff(lastResultSnapshot);
    if (extracted?.diffText) {
      setFileChanges(extracted);
      setFileChangesCollapsed(true);
      const first = extracted.files?.[0]?.path || '';
      setSelectedDiffFile(first);
    }
  }, [lastResultSnapshot, sshAiPrefs?.aiTask]);

  const executeCommandAndCapture = async (command) => {
    const cmd = normalizeAiTerminalCommand(String(command || '').replace(/[\r\n]+$/g, ''));
    if (!cmd) return '';
    setLastExecutedCommand(cmd);
    lastCommandSentAtRef.current = Date.now();
    sawOutputAfterCommandRef.current = false;
    commandRunningRef.current = true; // Mark command as in-flight
    // Track the last real shell command so [Wait] can inherit its timeout class
    if (!/^\[wait\]$/i.test(cmd) && !/^\[?ctrl\+c\]?$|^\^c$/i.test(cmd)) {
      lastCommandSentAtRef._lastRealCmd = cmd;
    }

    try {
      if (socketRef.current?.connected) {
        if (/^\[wait\]$/i.test(cmd)) {
          // AI specifically wants to wait for more output from a previous command
        } else if (/^\[?ctrl\+c\]?$|^\^c$/i.test(cmd)) {
          socketRef.current.emit('ssh:input', '\x03');
        } else {
          // Parse special control notations: ^X, ^O, ^R, [ESC]
          let finalInput = cmd;
          
          // 1. Handle [ESC]
          finalInput = finalInput.replace(/\[ESC\]/gi, '\x1b');
          
          // 2. Handle Ctrl+Letter notations: ^X, ^O, ^R (standalone tokens only)
          // IMPORTANT: only replace when ^[A-Z] appears at the start/end of the string or
          // surrounded by whitespace — never inside shell patterns like awk '/^Mem:/' where
          // ^M would otherwise become a carriage return.
          finalInput = finalInput.replace(/(^|\s)\^([A-Z])($|\s)/g, (m, pre, char, post) => {
            return pre + String.fromCharCode(char.charCodeAt(0) - 64) + post;
          });

          // 3. Append newline only if it's not a standalone control character or explicitly forbidden
          const isControlOnly = /[\x00-\x1F]/.test(finalInput) && finalInput.length <= 2;
          if (!isControlOnly && !finalInput.endsWith('\n')) {
             finalInput += '\n';
          }

          socketRef.current.emit('ssh:input', finalInput);
        }
        termInstanceRef.current?.focus();
        const settled = await waitForCommandSettle(cmd);
        const snap = settled?.snap ?? getOutputContext();
        setLastResultSnapshot(snap);

        // If the command landed us in an interactive prompt, try to handle it in Auto Mode.
        if (settled?.reason === 'interactive') {
          const prompt = settled.interactive;
          setInteractivePrompt(prompt);

          if (autoMode) {
            // ── Dynamic recovery ──────────────────────────────────────────────────────
            // For any blocking kind listed in DYNAMIC_BLOCKER_RECOVERY, auto-send the
            // recovery action and continue without stopping the engine.
            // Kinds intentionally excluded (password/passphrase/sudo_password) fall
            // through to the hard-stop below because they need real credentials.
            const recovery = DYNAMIC_BLOCKER_RECOVERY[prompt?.kind];
            if (recovery) {
              console.log(`[AI Agent] Auto-unblocking "${prompt.kind}": ${recovery.label}`);
              socketRef.current?.emit('ssh:input', recovery.action);
              setInteractivePrompt(null);
              await new Promise(r => setTimeout(r, recovery.waitMs));
              const nextSnap = getOutputContext();
              setLastResultSnapshot(nextSnap);
              return nextSnap;
            }

            // Credential / unknown prompts — pause and ask the user
            setAiError(t('ai.pausedPrompt'));
            setAutoMode(false);
            setAiOpen(true);
            setAiHasOpenedOnce(true);
          }
          return snap;
        }

        if (settled?.reason === 'editor') {
          if (autoMode) {
            const recoveredSnap = await tryAutoRecoverBlockedTerminal(snap, cmd);
            if (recoveredSnap) return recoveredSnap;
          }
          return snap;
        }

        // Streaming commands (pm2 log, tail -f, etc.) need Ctrl+C to exit
        if (settled?.reason === 'streaming') {
          if (autoMode) {
            // Auto-send Ctrl+C to exit the streaming command
            socketRef.current?.emit('ssh:input', '\x03'); // Ctrl+C
            await new Promise(r => setTimeout(r, 800));
            const nextSnap = getOutputContext();
            setLastResultSnapshot(nextSnap);
            // Mark as ready for next command
            setLastResultAt((prev) => {
              const next = Date.now();
              const p = Number(prev || 0);
              return next > p ? next : p + 1;
            });
            return nextSnap;
          }
          // In manual mode, just inform the user
          setAiError('Streaming command detected. Press Ctrl+C to exit, or wait for it to finish.');
          return snap;
        }

        if (settled?.reason === 'busy' || settled?.reason === 'stuck') {
          if (autoMode) {
            const recoveredSnap = await tryAutoRecoverBlockedTerminal(snap, cmd);
            if (recoveredSnap && looksLikeShellPrompt(recoveredSnap)) {
              return recoveredSnap;
            }
          }
          // Command is still running (hit timeout). Do NOT fire lastResultAt here —
          // runAutoStep's own polling will re-check after seeing isStillRunning in the prompt.
          // Just update the snapshot so the AI sees fresh partial output.
          setAiError('Command is still running... (Waiting for AI decision)');
          maybeHandleInteractivePrompt(snap);
          return snap;
        }

        // Command finished cleanly (prompt detected or error settled)
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });

        maybeHandleInteractivePrompt(snap);
        return snap;
      }
      if (termInstanceRef.current) termInstanceRef.current.focus();
      return '';
    } finally {
      commandRunningRef.current = false; // Always clear the in-flight flag
    }
  };

  const askAiWithPrompt = async (prompt) => {
    const p = String(prompt || '').trim();
    if (!p) return;
    setAiOpen(true);
    setAiHasOpenedOnce(true);
    setAiError(null);
    setAiAnswer(null);
    setExecuteConfirmOpen(false);
    
    // Add user message to chat history
    const userMsg = { id: Date.now(), role: 'user', content: p, timestamp: new Date() };
    setChatHistory(prev => [...prev, userMsg]);
    setAiPrompt(''); // Clear input immediately for chat-like feel
    
    return handleAskAi(p);
  };

  const handleAskAi = async (promptOverride) => {
    // Fix state routing to Manual mode for this entire operation
    const setAiLoading = setManualAiLoading;
    const setAiAnswer = setManualAiAnswer;
    const setAiError = setManualAiError;
    const setAiDone = setManualAiDone;
    const setAiDoneSummary = setManualAiDoneSummary;
    const setAiStreaming = setManualAiStreaming;
    const setAiStreamText = setManualAiStreamText;
    if (!isLoggedIn) {
      setAiError(t('ai.loginRequired'));
      return;
    }
    const effectivePrompt = String(promptOverride ?? aiPrompt).trim();
    if (!effectivePrompt || aiLoading) return;

    // In Code Editor mode, require at least one @file mention so the AI knows exactly which file
    if (sshAiPrefs?.aiTask === 'code' && !effectivePrompt.includes('@')) {
      setNoMentionWarning(true);
      setTimeout(() => setNoMentionWarning(false), 4000);
      // Open the mention picker immediately so the user can pick a file
      if (aiPromptRef.current) {
        const pos = aiPromptRef.current.selectionStart ?? effectivePrompt.length;
        handleAiMentionDetect(effectivePrompt + '@', effectivePrompt.length + 1, 'prompt');
        setAiPrompt(prev => prev + '@');
        setTimeout(() => aiPromptRef.current?.focus(), 0);
      }
      return;
    }
    setNoMentionWarning(false);
    setAiLoading(true);
    setAiStreaming(false);
    setAiStreamText('');
    setAiError(null);
    setAiAnswer(null);
    try {
      // Add user message to conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'user', content: effectivePrompt }
      ].slice(-8); // Keep last 8 turns for loop prevention

      // Streaming attempt (Groq models). Falls back to normal JSON if unsupported.
      let data = null;
      let streamedAnswer = '';
      try {
        setAiStreaming(true);
        const streamRes = await fetch('/api/ssh/ai-help?stream=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: effectivePrompt,
            context: getOutputContext().slice(-2500),
            contextPack: buildAiContextPack(),
            connectionName,
            host,
            prefs: sshAiPrefs,
            model: sshAiPrefs.aiModel || 'auto',
            tmuxActive: !!sshAiPrefs?.autoTmux,
            history: aiConversationRef.current.slice(-8).slice(0, -1),
          }),
        });

        const contentType = streamRes.headers.get('content-type') || '';
        if (!streamRes.ok || !contentType.includes('text/event-stream') || !streamRes.body) {
          throw new Error('Streaming not available');
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const safeNarration = (text) => {
          // Keep UI simple: show only a short preview and hide raw <thought> content.
          const cleaned = String(text || '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '<thought>[hidden]</thought>')
            .replace(/\s+/g, ' ')
            .trim();
          return cleaned.slice(-220);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';

          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let eventName = 'message';
            let dataLine = '';
            for (const line of lines) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              if (line.startsWith('data:')) dataLine += line.slice(5).trim();
            }
            if (!dataLine) continue;

            let payload = null;
            try { payload = JSON.parse(dataLine); } catch { payload = null; }

            if (eventName === 'delta') {
              const delta = payload?.content || '';
              if (delta) {
                streamedAnswer += delta;
                setAiStreamText(safeNarration(streamedAnswer));
              }
            }
            if (eventName === 'final') {
              data = payload;
            }
            if (eventName === 'error') {
              throw new Error(payload?.error || 'Streaming error');
            }
          }
        }

        if (!data?.success) {
          // Sometimes final may not arrive; fallback to using streamedAnswer
          data = { success: true, answer: streamedAnswer, usedModel: null, usage: null };
        }
      } catch (streamErr) {
        setAiStreaming(false);
        setAiStreamText('');
        // Fallback to classic JSON API call
        const res = await apiFetch('/api/ssh/ai-help', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: effectivePrompt,
            context: getOutputContext().slice(-2500),
            contextPack: buildAiContextPack(),
            connectionName,
            host,
            prefs: sshAiPrefs,
            model: sshAiPrefs.aiModel || 'auto',
            tmuxActive: !!sshAiPrefs?.autoTmux,
            history: aiConversationRef.current.slice(-8).slice(0, -1),
          }),
        });
        data = await res.json();
      }

       let parsed = null;
       if (data.success) {
         parsed = parseAiAnswer(data.answer, { usedModel: data.usedModel });
         setAiAnswer(parsed);
         setSshAiHistory([{ prompt: effectivePrompt, answer: data.answer, date: new Date().toISOString() }, ...sshAiHistory].slice(0, 50));
       } else {
        if (data.error && /limit|quota|exceeded/i.test(data.error)) {
          setAiLimitHit(true);
          setAiLimitGoal(effectivePrompt);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return null;
        }
        throw new Error(data.error || 'AI request failed');
      }
      setLastAiUpdate(Date.now());
      
      // 🧪 Manual Mode Done Detection
      if (parsed?.done) {
        setTimeout(() => {
          showAiDoneModal({
            goal: effectivePrompt,
            steps: [], // In manual mode we don't track auto steps
            taskMode: sshAiPrefs?.aiTask || 'ssh',
            explain: parsed.explain || 'Task completed.',
          });
        }, 100);
      }

      // Sync AI usage across all windows immediately after use
      if (data.usage) {
        const syncChannel = new BroadcastChannel('ai_usage_sync');
        syncChannel.postMessage({ 
          type: 'sync', 
          used: data.usage.used, 
          limit: data.usage.limit 
        });
        syncChannel.close();
      }

      // Track AI response in conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'assistant', content: data.answer }
      ].slice(-12);

      // Add AI response to chat history
      const aiMsg = { 
        id: Date.now() + 1, 
        role: 'assistant', 
        content: parsed?.explain || data.answer,
        command: parsed?.command,
        danger: parsed?.danger,
        done: parsed?.done,
        warn: parsed?.warn,
        plan: parsed?.plan,
        thought: parsed?.thought,
        timestamp: new Date()
      };
      setChatHistory(prev => [...prev, aiMsg]);

      if (parsed) {
        const entry = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
          createdAt: Date.now(),
          type: 'manual',
          prompt: effectivePrompt,
          command: parsed.command,
          explain: parsed.explain,
          danger: parsed.danger,
          warn: parsed.warn,
          done: parsed.done,
        };

        // De-duplicate by prompt+command (keep most recent)
        const next = [entry, ...sshAiHistory.filter(h => !(h?.prompt === entry.prompt && h?.command === entry.command))].slice(0, 30);
        setSshAiHistory(next);
      }

      return parsed;
    } catch (e) {
      setAiError(String(e?.message || e));
    } finally {
      setAiLoading(false);
      setAiStreaming(false);
      setAiStreamText('');
      // NEW: Clear the active answer bubble in Manual Mode once it's safely moved to Chat History
      // This prevents the "duplicate" appearance shown in the user's screenshot.
      if (aiModeRef.current === 'manual') {
        setAiAnswer(null);
      }
    }
  };

  // Fetch matching skills with TIERED APPROACH:
  // 1. Pure AI first (no skills)
  // 2. Local skills on failure (mid-session injection)
  // 3. SkillsMP last resort (strict relevance filtering)
  // LIMIT: 1 skill per keyword/topic to prevent over-injection
  // Returns { skills: [...], allAvailable: [...], tier: string }
  const fetchSkillsForGoal = async (goalStr, tier = 'local', context = '') => {
    let skills = [];
    let allAvailable = [];
    const detectedOs = String(detectedOsRef.current || '').toLowerCase();
    const goalLower = String(goalStr || '').toLowerCase();
    
    // Extract key terms from goal for relevance matching
    const goalTerms = goalLower.split(/\s+/).filter(w => w.length > 3);
    const goalKeywords = goalTerms.filter(w => 
      !['install', 'setup', 'configure', 'run', 'start', 'deploy', 'the', 'and', 'with', 'using', 'ubuntu', 'debian', 'centos', 'fedora', 'alpine', 'amazon'].includes(w)
    );
    
    // === RELEVANCE SCORING ===
    // Score how relevant a skill is to the specific goal
    // Returns { score, matchedKeyword } to track which keyword it matched
    const scoreRelevance = (s) => {
      const name = String(s.name || '').toLowerCase();
      const desc = String(s.description || '').toLowerCase();
      const content = String(s.content || '').toLowerCase();
      const text = `${name} ${desc} ${content}`;
      
      let score = 0;
      let matchedKeyword = null;
      
      // Check if skill name/desc contains goal keywords
      for (const kw of goalKeywords) {
        if (name.includes(kw)) {
          score += 10;  // Name match is strongest
          matchedKeyword = kw;
        } else if (desc.includes(kw)) {
          score += 5;    // Description match
          matchedKeyword = kw;
        } else if (content.includes(kw)) {
          score += 2; // Content match
          matchedKeyword = kw;
        }
      }
      
      // Penalize generic skills without specific keywords
      if (name.match(/^(setup|install|configure|run)$/i) && goalKeywords.length > 0) {
        const hasSpecificTerm = goalKeywords.some(kw => text.includes(kw));
        if (!hasSpecificTerm) score -= 20;  // Heavy penalty for generic unrelated skills
      }
      
      // OS compatibility check
      const osPenalty = checkOsCompatibility(text, detectedOs);
      score += osPenalty;
      
      return { score: Math.max(score, 0), matchedKeyword };
    };
    
    // Check OS compatibility (returns penalty score)
    const checkOsCompatibility = (text, os) => {
      if (os.match(/linux|ubuntu|debian|centos|fedora|alpine|amazon/)) {
        if (text.includes('macos') || text.includes('brew install') || text.includes('launchctl')) {
          if (!text.includes('linux') && !text.includes('ubuntu')) return -50;
        }
      }
      if (os.match(/macos|darwin/)) {
        if (text.includes('apt-get') || text.includes('yum install') || text.includes('systemctl')) {
          if (!text.includes('brew') && !text.includes('macos')) return -50;
        }
      }
      return 0;
    };
    
    // === SELECT BEST SKILL PER KEYWORD ===
    // Groups skills by matched keyword, picks highest score per group
    const selectBestPerKeyword = (scoredSkills, maxPerKeyword = 1) => {
      const byKeyword = new Map();
      
      for (const s of scoredSkills) {
        const kw = s._matchedKeyword || 'general';
        if (!byKeyword.has(kw)) {
          byKeyword.set(kw, []);
        }
        byKeyword.get(kw).push(s);
      }
      
      // Sort each group by score and take top 1
      const selected = [];
      for (const [kw, skills] of byKeyword) {
        skills.sort((a, b) => b._score - a._score);
        selected.push(skills[0]);
        console.log(`[Skills] Best for "${kw}": "${skills[0].name}" (score: ${skills[0]._score})`);
      }
      
      return selected;
    };
    
    // === TIER 1: LOCAL SKILLS ===
    if (tier === 'local' || tier === 'skillsmp') {
      try {
        const res = await apiFetch('/api/skills/local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: goalStr }),
        });
        const data = await res.json();
        if (data.success) {
          const localRaw = Array.isArray(data.skills) ? data.skills : [];
          // Score and filter by relevance
          const scored = localRaw
            .map(s => {
              const { score, matchedKeyword } = scoreRelevance(s);
              return { ...s, _score: score, _matchedKeyword: matchedKeyword };
            })
            .filter(s => s._score > 0);
          
          // Select best skill per keyword
          skills = selectBestPerKeyword(scored);
          allAvailable = Array.isArray(data.allAvailable) ? data.allAvailable : [];
          console.log(`[Skills] Local: ${skills.length} skills (1 per keyword)`);
        }
      } catch (e) {
        console.warn('[Skills] Local fetch failed:', e);
      }
    }
    
    // === TIER 2: SKILLSMP (LAST RESORT) ===
    // Only search if tier is explicitly 'skillsmp' or local found nothing
    if (tier === 'skillsmp' || (tier === 'local' && skills.length === 0)) {
      try {
        console.log('[Skills] Searching SkillsMP (last resort) for:', goalStr);
        const osContext = detectedOs ? ` for ${detectedOs}` : '';
        const externRes = await apiFetch('/api/skills/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: goalStr + osContext, type: 'ai' })
        });
        const externData = await externRes.json();
        
        if (externData.success && Array.isArray(externData.skills)) {
          // Score and filter with STRICT relevance
          const externScored = externData.skills
            .map(s => {
              const { score, matchedKeyword } = scoreRelevance(s);
              return { ...s, _score: score, _matchedKeyword: matchedKeyword, _source: 'skillsmp' };
            })
            .filter(s => s._score > 5);  // Higher threshold for external skills
          
          // Select best skill per keyword
          const externSelected = selectBestPerKeyword(externScored);
          
          // Only add keywords not already covered by local skills
          const localKeywords = new Set(skills.map(s => s._matchedKeyword));
          for (const s of externSelected) {
            if (!localKeywords.has(s._matchedKeyword)) {
              skills.push(s);
              console.log(`[Skills] SkillsMP: "${s.name}" for "${s._matchedKeyword}" (score: ${s._score})`);
            }
          }
        }
      } catch (e) {
        console.warn('[Skills] External SkillsMP search failed:', e);
      }
    }
    
    const usedTier = skills.length > 0 ? (skills.some(s => s._source === 'skillsmp') ? 'skillsmp' : 'local') : 'none';
    return { skills, allAvailable, tier: usedTier };
  };

  // Extract a useful SkillsMP query from the current goal string and recent context
  const skillQueryFromGoal = (goalStr, contextStr = '') => {
    const g = String(goalStr || '').toLowerCase().trim();
    const c = String(contextStr || '').toLowerCase().trim();

    // 1. Context-aware overrides (The "problem" logic)
    // If we see specific errors in the output, prioritizing searching for those fixes
    if (c.includes('nginx') && (c.includes('emerg') || c.includes('fail') || c.includes('configtest'))) return 'nginx configuration troubleshooting';
    if (c.includes('docker') && (c.includes('permission denied') || c.includes('connect to the docker daemon'))) return 'docker sudoless setup';
    if (c.includes('docker') && c.includes('command not found')) return 'install docker ubuntu';
    if (c.includes('npm err') || c.includes('enoent')) return 'npm install troubleshooting';
    if (c.includes('pm2') && c.includes('command not found')) return 'install pm2 global';
    if (c.includes('address already in use') || c.includes('eaddrinuse')) return 'kill process on port';
    if (c.includes('connection refused')) return 'linux network troubleshooting';
    if (c.includes('permission denied') || c.includes('eacces')) return 'linux file permissions';
    if (c.includes('syntax error')) return 'fix syntax error code';

    // 2. Goal-based matchers (Fallback)
    const matchers = [
      [/docker|dockerfile|container|compose/, 'docker deployment'],
      [/nginx|apache|caddy|web server/, 'nginx web server'],
      [/pm2|node|nodejs|next\.?js/, 'nodejs pm2 deployment'],
      [/ssl|certbot|https|letsencrypt/, 'ssl certificates'],
      [/deploy|deployment/, 'linux deployment'],
      [/firewall|ufw|iptables/, 'firewall management'],
      [/git|clone|push|pull/, 'git workflow'],
      [/ssh|remote/, 'ssh management'],
      [/postgres|mysql|mongo|database|db/, 'database setup'],
      [/systemd|service|daemon/, 'systemd services'],
    ];
    for (const [re, label] of matchers) {
      if (re.test(g)) return label;
    }
    // Fallback: first 4 words of the goal
    return g.split(/\s+/).slice(0, 4).join(' ') || 'linux automation';
  };

  // Helper: Extract ONLY output after last command
  const extractPostCommandContext = (fullSnap, lastCmd) => {
    if (!lastCmd) return fullSnap;
    const lines = fullSnap.split('\n');
    let cmdIdx = -1;
    const cmdTrimmed = String(lastCmd).trim().slice(0, 80); 
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes(cmdTrimmed)) { cmdIdx = i; break; }
    }
    if (cmdIdx >= 0 && cmdIdx < lines.length - 2) {
        return lines.slice(cmdIdx + 1).join('\n');
    }
    return fullSnap;
  };

  function tokenizeCompletionText(text) {
    return Array.from(new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length >= 4)
        .filter(token => !new Set(['this', 'that', 'with', 'from', 'your', 'have', 'been', 'will', 'into', 'after', 'before', 'then', 'than']).has(token))
    ));
  }

  function looksLikeCompletionText(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;

    // 🧪 SENTINEL GUARD: If the text contains the internal background task marker,
    // it's a technical signal, NOT a human-readable completion message. 
    // Ignore it here so the AI is forced to provide a proper explanation.
    if (t.includes('__ai_done__') || t.includes('__bgtask')) return false;

    const isIntentOrCheck = /^(i\s+will|i\s+need\s+to|i'm\s+(going\s+to|going|now|planning\s+to)|checking\s+(for|if|the)|let\s+me\s+check|looking\s+at|scouting|verifying\b)/i.test(t);
    if (isIntentOrCheck) return false;

    // 🧪 NEGATIVE CONTEXT: Even if it says "success", if it specifically mentions that an error still "indicates" 
    // a need for more work, or if it uses "but/however" to describe a remaining problem, it's NOT done.
    const hasRemainingProblem = /(but|however|although|error|instead|failed|indicates we|yet to|still requires|must now|need to)/i.test(t);
    const didSolve = /(solved|fixed|resolved|finalized) the (error|issue|problem|mismatch)/i.test(t);
    if (hasRemainingProblem && !didSolve) return false;

    // 🧪 SKEPTICISM: Completion text must be definitive. If it sounds like discovery, it's not done.
    const isDiscovery = /\b(found|located|see|presence|exists|existing)\b/i.test(t) && !/\b(working|verified|running|active)\b/i.test(t);
    if (isDiscovery && !t.includes('success')) return false;

    // 🧪 Expanded to catch common AI "done" phrases. Must be a declarative statement.
    return /(task complete|finished goal|goal achieved|completed successfully|issue resolved|successfully verified|verification passed|all set|done successfully|looks good|working now|fixed now|already satisfied|goal[\s\S]*satisfied|task[\s\S]*satisfied|goal[\s\S]*done|task[\s\S]*done|mission accomplished|everything looks correct|evidence confirms completion|goal is met|goal is satisfied|already met|already finished)/.test(t);
  }

  function inferDynamicCompletionEvidence({ goal, output, lastCommand, err, isStillRunning, stepsDone }) {
    if (err || isStillRunning || !stepsDone) {
      return { done: false, reason: '', confidence: 0 };
    }

    const goalLower = String(goal || '').toLowerCase();
    const outputLower = String(output || '').toLowerCase();
    const commandLower = String(lastCommand || '').toLowerCase();

    // 🧪 BACKGROUND TASK SKEPTICISM: If the last command was a tmux backgrounding operation,
    // a successful exit code only means the keys were SENT. It does NOT mean the task is done.
    if (commandLower.includes('tmux') && (commandLower.includes('send-keys') || commandLower.includes('-d'))) {
        return { done: false, reason: 'Background task initiated; awaiting verification.', confidence: 0 };
    }

    const positivePatterns = [
      /\bsuccess(?:ful|fully)?\b/,
      /\bcomplete(?:d)?\b/,
      /\bverified?\b/,
      /\bhealthy\b/,
      /\bready\b/,
      /\blistening\b/,
      /\brunning\b/,
      /\bactive\b/,
      /\bonline\b/,
      /\bpass(?:ed)?\b/,
      /\bstarted\b/,
      /\bcreated\b/,
      /\bavailable\b/,
      /\bok\b/,
    ];
    const negativePatterns = [
      /\berror\b/,
      /\bfailed?\b/,
      /\bdenied\b/,
      /\binvalid\b/,
      /\bmissing\b/,
      /not found/,
      /\brefused\b/,
      /\btraceback\b/,
      /\bexception\b/,
      /\bfatal\b/,
      /\bpanic\b/,
      /\bcannot\b/,
      /\bunable\b/,
      /\bemerg\b/,
      /\bsyntax error\b/,
      /\btest failed\b/,
    ];
    const absencePatterns = [
      /\bnot found\b/,
      /\bnot installed\b/,
      /\bno such\b/,
      /\bdoes not exist\b/,
      /\balready (?:removed|deleted|absent|uninstalled)\b/,
      /\bnothing to (?:remove|uninstall|delete|purge)\b/,
    ];
    const removalPatterns = [
      /\bremoved?\b/,
      /\buninstalled?\b/,
      /\bpurged?\b/,
      /\bdeleted?\b/,
    ];
    const verificationCommand = /(\bstatus\b|\bis-active\b|\bcheck\b|\btest\b|\bverify\b|\bhealth\b|\bcurl\b|\bss\b|\blsof\b|\bgrep\b|\bhead\b|\btail\b|\bnginx\s+-t\b)/.test(commandLower);
    const removeIntent = /\b(remove|uninstall|delete|purge|clean\s+up|deinstall)\b/.test(goalLower);
    const installIntent = /\b(install|setup|set up|deploy|add|enable|launch|start|run)\b/.test(goalLower) && !removeIntent;
    const verifyIntent = /\b(check|verify|verification|status|test|inspect|diagnose|debug|health)\b/.test(goalLower) || verificationCommand;

    const countHits = (patterns, text) => patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    const positiveHits = countHits(positivePatterns, outputLower);
    const negativeHits = countHits(negativePatterns, outputLower);
    const absenceHits = countHits(absencePatterns, outputLower);
    const removalHits = countHits(removalPatterns, outputLower);
    const isListingCommand = /(\bls\b|\bfind\b|\blist\b|\bdir\b)/.test(commandLower);
    const isDockerCommand = /(\bdocker\b|\bdocker-compose\b)/.test(commandLower);
    const goalTokens = tokenizeCompletionText(goalLower);
    const overlapHits = goalTokens.reduce((count, token) => count + (outputLower.includes(token) ? 1 : 0), 0);

    // 🧪 SKEPTICISM: If the last command was just 'ls' or 'find', seeing the terms in the output
    // is NOT evidence of completion for an "install" or "fix" goal.
    if (isListingCommand && (installIntent || !verifyIntent) && overlapHits > 0 && positiveHits < 2) {
       return { done: false, reason: 'Listing files is not proof of installation or a fix.', confidence: 0 };
    }

    // 🧪 DOCKER SKEPTICISM: If goal is "install on docker" but last command wasn't docker-related,
    // or if docker output doesn't show the name, we are NOT done.
    if (goalLower.includes('docker') && !isDockerCommand) {
       return { done: false, reason: 'Goal involves Docker; verification via docker commands is required.', confidence: 0 };
    }

    // Dynamic confidence calculation based on evidence strength and session history
    const sessionReliability = adaptiveWaitRef.current?.totalCommands > 5 ? 0.05 : 0;
    const baseConfidence = 0.85 + sessionReliability;

    if (removeIntent && (absenceHits > 0 || removalHits > 0) && negativeHits === 0) {
      const confidence = Math.min(baseConfidence + 0.1 + (removalHits * 0.02), 0.99);
      return { done: true, reason: 'terminal shows the target is absent or removed', confidence };
    }
    if (verifyIntent && positiveHits > 0 && negativeHits === 0) {
      // For docker, ensure hits are within a docker ps or similar
      if (goalLower.includes('docker') && !isDockerCommand) return { done: false, reason: 'Docker-specific verification needed.', confidence: 0 };
      const confidence = Math.min(baseConfidence + 0.05 + (positiveHits * 0.02), 0.98);
      return { done: true, reason: 'verification command returned positive output', confidence };
    }
    if (installIntent && positiveHits >= 2 && negativeHits === 0) {
      const confidence = Math.min(baseConfidence + (positiveHits * 0.015), 0.95);
      return { done: true, reason: 'recent output indicates the service or deployment is healthy', confidence };
    }
    if (positiveHits >= 2 && overlapHits > 0 && negativeHits === 0) {
      const confidence = Math.min(baseConfidence - 0.05 + (overlapHits * 0.02), 0.92);
      return { done: true, reason: 'goal terms overlap with positive terminal evidence', confidence };
    }

    // 🧪 NEGATIVE SIGNAL GUARD: If ANY negative patterns are found, we are most likely NOT done.
    if (negativeHits > 0) {
        return { done: false, reason: 'Negative signals (errors/failures) detected in output', confidence: 0 };
    }

    return { done: false, reason: '', confidence: 0 };
  }

  const handleSkillsSearch = async (query) => {
    if (!query) return;
    setSkillsSearchLoading(true);
    setSkillsSearchResults(null);
    setInjectedSkills(null);

    const allFound = [];

    // ── Step 1: Always search local skills first (reliable) ──
    try {
      const localRes = await apiFetch('/api/skills/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      const localData = await localRes.json();
      if (localData.success && Array.isArray(localData.skills)) {
        for (const s of localData.skills) allFound.push({ ...s, _source: 'local' });
      }
    } catch (e) {
      console.warn('[Skills] Local search failed:', e);
    }

    // ── Step 2: Try external SkillsMP too (best-effort) ──
    // Uses 'smart' mode: AI extracts concise keywords → normal keyword search (no rate-limit hit)
    try {
      const res = await apiFetch('/api/skills/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, type: 'smart' })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.skills)) {
        // Only add SkillsMP skills that aren't already in local results
        const localNames = new Set(allFound.map(s => s.name));
        for (const s of data.skills) {
          if (!localNames.has(s.name)) allFound.push({ ...s, _source: 'skillsmp' });
        }
        // Auto-install installable SkillsMP skills silently (no button click needed)
        const installable = data.skills.filter(s => s.id && s.content);
        for (const skill of installable.slice(0, 2)) { // Max 2 auto-installs
          try {
            await apiFetch('/api/skills/install', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: skill.id, name: skill.name, description: skill.description || '', content: skill.content })
            });
            console.log(`[SkillsMP] Auto-installed skill: ${skill.name}`);
          } catch (installErr) {
            console.warn(`[SkillsMP] Auto-install failed for ${skill.name}:`, installErr);
          }
        }
      }
    } catch (e) {
      // External SkillsMP unavailable — that's fine, we have local skills
      console.warn('[Skills] SkillsMP search skipped:', e.message);
    }

    // ── Step 3: Inject skills with BALANCED fallback ──
    // Prioritize high-quality local results, but ALWAYS leave room for SkillsMP (SMP)
    // especially if the user goal is complex.
    const deduped = [];
    const seenSlugs = new Set();
    
    // First, pick the best 2 locals
    const locals = allFound.filter(s => s._source === 'local');
    for (const s of locals) {
      const slug = String(s.name || '').toLowerCase().split(/[-_\s]/)[0];
      if (!seenSlugs.has(slug) && s.content) {
        seenSlugs.add(slug);
        deduped.push(s);
      }
      if (deduped.length >= 2) break;
    }

    // Then, fill with up to 3 SkillsMP results (the fallback/override)
    const smp = allFound.filter(s => s._source === 'skillsmp');
    for (const s of smp) {
      const slug = String(s.name || '').toLowerCase().split(/[-_\s]/)[0];
      if (!seenSlugs.has(slug) && s.content) {
        seenSlugs.add(slug);
        deduped.push(s);
      }
      if (deduped.length >= 5) break; // Total cap of 5 now
    }

    // Merge with any previously loaded skills (don't lose what was loaded on start)
    const prev = Array.isArray(preloadedSkillsRef.current) ? preloadedSkillsRef.current : [];
    const prevNames = new Set(prev.map(s => s.name));
    const merged = [...prev];
    for (const s of deduped) {
      if (!prevNames.has(s.name)) {
        merged.push(s);
      }
    }
    // Final hard cap of 6 total skills for prompt efficiency
    preloadedSkillsRef.current = merged.slice(0, 6);
    setActiveSkills(preloadedSkillsRef.current); // Update persistent UI state
    console.log(`[SkillsMP] Blended ${deduped.length} new skills (Prefer SMP fallback). Total: ${preloadedSkillsRef.current.length}`);


    // Show the injection panel to the user
    const allAvailableNames = [...new Set([
      ...prev.map(s => `${s.name}(${s.source || 'loaded'})`),
      ...deduped.map(s => `${s.name}(${s._source || s.source || 'found'})`),
    ])];
    setInjectedSkills({
      skills: deduped,
      allAvailable: allAvailableNames,
    });

    if (deduped.length > 0) {
      // Skills ready - AI will use them on next step (no need to pause)
      console.log(`[Skills] Injected ${deduped.length} skills:`, deduped.map(s => s.name));
      setAiError(null); // Clear any previous error
    } else {
      setAiError(`No matching skills found for "${query}". AI will use pure reasoning.`);
    }

    setSkillsSearchLoading(false);
    // Auto-dismiss injection panel after 10s
    setTimeout(() => setInjectedSkills(null), 10000);
  };

  const handleInstallSkill = async (skill, autoResume = true) => {
    if (!skill?.id) return;
    setAiLoading(true);
    try {
      const res = await apiFetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: skill.id, 
          name: skill.name, 
          description: skill.description || '',
          content: skill.content 
        })
      });
      const data = await res.json();
      if (data.success) {
        setAiError(`✅ Skill "${skill.name}" injected! Continuing engine...`);
        setSkillsSearchResults(prev => prev.filter(s => s.id !== skill.id));
        
        // Auto-resume engine if requested (inject automatic)
        if (autoResume) {
          setAiMode('auto');
          setAutoMode(true);
          const currentGoal = String(autoGoalRef.current || aiPromptRef.current || '').trim();
          if (currentGoal) {
            console.log('[AI Skill] Injection successful, resuming engine with goal:', currentGoal);
            // Dynamic delay based on adaptive wait system
            const resumeDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 500, 200);
            setTimeout(() => runAutoStep(), resumeDelay);
          }
        }
      } else {
        setAiError(`Injection failed: ${data.error}`);
        setAiLoading(false);
      }
    } catch (err) {
      console.error('Skill injection failed:', err);
      setAiError(`Skill injection failed: ${err.message}`);
      setAiLoading(false);
    }
  };

  const runAutoStep = async (snapshotOverride, nudgeMsg = '') => {
    // Fix state routing to Auto mode for this entire operation
    const setAiLoading = setAutoAiLoading;
    const setAiAnswer = setAutoAiAnswer;
    const setAiError = setAutoAiError;
    const setAiDone = setAutoAiDone;
    const setAiDoneSummary = setAutoAiDoneSummary;
    const setAiStreaming = setAutoAiStreaming;
    const setAiStreamText = setAutoAiStreamText;
    if (!isLoggedIn) return;
    // Use refs instead of closed-over state — fixes stale-state bug when called from setTimeout
    if (aiModeRef.current !== 'auto') return;
    if (!autoModeRef.current) return;
    if (autoRunningRef.current) return;
    // ⛔ Hard guard: never call the AI while a compilation (cargo/make/gcc) is actively running.
    // "Compiling / Linking / Building" in the recent output means the process hasn't finished.
    // We reschedule in 4 s instead of wasting an API call.
      if (commandRunningRef.current) return;
      {
        const liveSnap = getOutputContext();
        const isLivelyCompiling = hasActiveDownloadOrBuild(liveSnap);
        if (isLivelyCompiling && !looksLikeShellPrompt(liveSnap)) {
          const waitSec = calculateDynamicWait(false, true, false);
          console.log(`[AI Agent] Download/build still in progress — deferring AI call by ${waitSec}s (adaptive)`);
          if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
          autoTimerRef.current = setTimeout(() => runAutoStep(liveSnap), waitSec * 1000);
          return;
        }
      }
    if (Number.isFinite(autoStepsRemaining) && autoStepsRemaining <= 0) {
      setAiError(t('ai.autoFinished'));
      setAutoMode(false);
      setAiOpen(true);
      setAiHasOpenedOnce(true);
      return;
    }

    const goal = String(autoGoal || aiPrompt || '').trim();
    if (!goal) {
      setAiError(t('ai.goalRequired'));
      setAutoMode(false);
      return;
    }

    let snap = String(snapshotOverride ?? lastResultSnapshot ?? getOutputContext() ?? '').trim();
    const err = detectTerminalError(snap);
    let sudoNudge = '';
    if (err?.type === 'permission_denied' && sshAiPrefs?.preferSudo) {
      sudoNudge = `\n\n⚠️ PERMISSION DENIED: Your last command failed due to permissions. Since 'Prefer sudo' is enabled, please use 'sudo' for your next approach if appropriate.`;
    }

    // 🔄 Loop detection & self-healing injection
    const loopKey = `${lastExecutedCommand || ''}::${normalizeForLoop(snap).slice(-200)}`;
    let autoPromptExpansion = sudoNudge;
    
    // 🧪 ROBUSTNESS: If we are nudging, EXEMPT this turn from the Loop Detector
    // because no command has run yet, so the snapshot is EXPECTED to be identical.
    if (autoLastLoopKeyRef.current === loopKey && !nudgeMsg) {
      autoLoopRepeatRef.current += 1;
      // INJECT WARNING TO AI: Explain that it is repeating itself
      if (autoLoopRepeatRef.current >= 2) {
        autoPromptExpansion += `\n\n⚠️ LOOP WARNING: Your last command produced NO change in the terminal output. 
REPEAT COUNT: ${autoLoopRepeatRef.current}. 
CHANGE YOUR STRATEGY: Use different flags, check paths with absolute references, or use a diagnostic tool like 'ls -la' to see what's actually there.`;
      }
    } else {
      if (!nudgeMsg) {
        autoLastLoopKeyRef.current = loopKey;
        autoLoopRepeatRef.current = 0;
      }
    }

    if (autoLoopRepeatRef.current >= 3) {
      if (sshAiPrefs?.aiTask === 'code') {
        // Code mode: don't search skills — force the AI to produce a diff patch
        autoLoopRepeatRef.current = 0;
        autoLastLoopKeyRef.current = '';
        autoRunningRef.current = false;
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => runAutoStep(snap,
          `\n\n⚠️ LOOP DETECTED (Code Mode): You have run the same read command ${autoLoopRepeatRef.current + 3} times without producing a patch.\nYou MUST now output a <diff> patch to edit the file. Do NOT run cat/head/tail again. Use the file content you already have and produce the unified diff NOW.`
        ), 800);
        return;
      }
      // Use recent output for smarter skill search
      const postCmdContext = extractPostCommandContext(snap, lastExecutedCommand);
      const _loopSkillQuery = skillQueryFromGoal(goal, postCmdContext);
      console.log('[AI Agent] Loop detected — searching SkillsMP for:', _loopSkillQuery);
      setAiError(`Auto Mode paused: AI is stuck in a loop. Searching SkillsMP for "${_loopSkillQuery}" skills to help break through...`);
      setAutoMode(false);
      setAiOpen(true);
      setAiHasOpenedOnce(true);
      handleSkillsSearch(_loopSkillQuery);
      return;
    }

    const curSig = computeErrorSignature(snap);
    const curKey = `${String(lastExecutedCommand || '').trim()}::${curSig}`;
    if (autoRepeatSigRef.current.key === curKey) {
      autoRepeatSigRef.current.count += 1;
      
      // === MID-SESSION SKILL INJECTION ON FAILURE ===
      // After 3 repeated failures with no skills: inject LOCAL skills
      // After 5 repeated failures: inject SkillsMP skills (last resort)
      if (autoRepeatSigRef.current.count >= 3 && skillInjectionAttemptsRef.current === 0) {
        console.log('[Skills] AI failing - injecting LOCAL skills (attempt 1)');
        skillInjectionAttemptsRef.current = 1;
        const goal = autoGoalRef.current || autoGoal || '';
        fetchSkillsForGoal(goal, 'local', snap).then(({ skills }) => {
          if (skills.length > 0) {
            preloadedSkillsRef.current = skills;
            setActiveSkills(skills);
            setInjectedSkills({ skills, allAvailable: [] });
            console.log(`[Skills] Injected ${skills.length} local skills mid-session`);
            // Continue with enhanced context
            autoRepeatSigRef.current = { key: curKey, count: 0 };
            const injectWait = calculateDynamicWait(false, false, false) * 500;
            setTimeout(() => runAutoStep(snap), injectWait);
            return;
          }
        });
        return;
      }
      
      if (autoRepeatSigRef.current.count >= 5 && skillInjectionAttemptsRef.current === 1) {
        console.log('[Skills] Local skills failed - REPLACING with SkillsMP (last resort)');
        skillInjectionAttemptsRef.current = 2;
        const goal = autoGoalRef.current || autoGoal || '';
        fetchSkillsForGoal(goal, 'skillsmp', snap).then(({ skills }) => {
          if (skills.length > 0) {
            // REPLACE local skills completely - they didn't work
            preloadedSkillsRef.current = skills;
            setActiveSkills(skills);
            setInjectedSkills({ skills, allAvailable: [] });
            console.log(`[Skills] Replaced with ${skills.length} SkillsMP skills (local skills removed)`);
            autoRepeatSigRef.current = { key: curKey, count: 0 };
            const injectWait = calculateDynamicWait(false, false, false) * 500;
            setTimeout(() => runAutoStep(snap), injectWait);
            return;
          } else {
            // SkillsMP found nothing - clear skills and let AI continue raw
            console.log('[Skills] SkillsMP found nothing - continuing without skills');
            preloadedSkillsRef.current = [];
            setActiveSkills([]);
            autoRepeatSigRef.current = { key: curKey, count: 0 };
          }
        });
        return;
      }
      
      // After 7 failures even with SkillsMP - give up skills, let AI try raw
      if (autoRepeatSigRef.current.count >= 7 && skillInjectionAttemptsRef.current >= 2) {
        console.log('[Skills] All skills failed - clearing skills, AI must solve without help');
        preloadedSkillsRef.current = [];
        setActiveSkills([]);
        setInjectedSkills(null);
        skillInjectionAttemptsRef.current = 3;
        autoRepeatSigRef.current = { key: curKey, count: 0 };
      }
      
      // After 2 repeats, reset so the AI gets a fresh attempt with richer context
      if (autoRepeatSigRef.current.count >= 2) {
        autoRepeatSigRef.current = { key: curKey, count: 0 };
      }
    } else {
      autoRepeatSigRef.current = { key: curKey, count: 0 };
    }

    const editorType = looksLikeEditorOrPager(snap);
    const interactive = detectInteractivePrompt(snap);
    const isStillRunning = !looksLikeShellPrompt(snap);
    const streamingMode = looksLikeStreamingMode(snap, lastExecutedCommand);
    
    let terminalStatus = isStillRunning ? 'RUNNING (No prompt yet)' : 'IDLE (Prompt detected)';
    if (streamingMode) terminalStatus = `STREAMING MODE (${streamingMode})`;
    else if (editorType) terminalStatus = `INTERACTIVE PAGER/EDITOR ACTIVE (${editorType})`;
    else if (interactive) terminalStatus = `INTERACTIVE PROMPT DETECTED (${interactive.kind})`;

    // Auto-exit streaming commands (pm2 log, tail -f, etc.) before proceeding
    if (streamingMode && isStillRunning) {
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      const timeSinceCommand = Date.now() - (lastCommandSentAtRef.current || 0);
      if (idleFor > 2000 || timeSinceCommand > 5000) {
        // Send Ctrl+C to exit the streaming command
        socketRef.current?.emit('ssh:input', '\x03');
        const exitDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 800, 300);
        await new Promise(r => setTimeout(r, exitDelay));
        const nextSnap = getOutputContext();
        setLastResultSnapshot(nextSnap);
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });
        // Re-check after exiting streaming mode
        autoRunningRef.current = false;
        const retryDelay = calculateDynamicWait(false, false, false) * 500;
        setTimeout(() => runAutoStep(nextSnap), retryDelay);
        return;
      }
    }

    // Auto-exit safe pagers (less/more/man) that block the prompt, so Auto Mode can continue.
    // IMPORTANT: Only do this for pagers, NOT editors like vim/nano.
    if (editorType && isStillRunning) {
      const safePagerTypes = new Set(['pager', 'man']);
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      const timeSinceCommand = Date.now() - (lastCommandSentAtRef.current || 0);
      if (safePagerTypes.has(String(editorType)) && (idleFor > 1500 || timeSinceCommand > 4000)) {
        let currentSnap = getOutputContext();

        // Guard: only act if the pager is still active
        if (!looksLikeShellPrompt(currentSnap)) {
          // Step 1: If the pager is showing a "press RETURN/ENTER" interstitial
          // (e.g. "Log file is already in use (press RETURN)"), we MUST send Enter
          // first to dismiss it before we can send 'q' to exit the pager.
          const needsReturn = /press\s+(return|enter)/i.test(currentSnap);
          const baseDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 600, 200);
          if (needsReturn) {
            socketRef.current?.emit('ssh:input', '\r');
            await new Promise(r => setTimeout(r, baseDelay));
            currentSnap = getOutputContext();
          }

          // Step 2: If we're still in the pager (no shell prompt yet), send 'q'
          if (!looksLikeShellPrompt(currentSnap)) {
            socketRef.current?.emit('ssh:input', 'q');
            await new Promise(r => setTimeout(r, baseDelay + 100));

            // Step 3: After 'q', flush any leftover chars with Ctrl+U
            // in case the pager exited before consuming the 'q'
            const snapAfterQ = getOutputContext();
            if (looksLikeShellPrompt(snapAfterQ)) {
              socketRef.current?.emit('ssh:input', '\x15'); // Ctrl+U — kill line
              await new Promise(r => setTimeout(r, Math.max(baseDelay * 0.3, 100)));
            }
          }
        }

        const nextSnap = getOutputContext();
        setLastResultSnapshot(nextSnap);
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });
        autoRunningRef.current = false;
        const pagerRetryDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 400, 150);
        setTimeout(() => runAutoStep(nextSnap), pagerRetryDelay);
        return;
      }

      if ((editorType === 'vim' || editorType === 'nano') && (idleFor > 1200 || timeSinceCommand > 2500)) {
        const recoveredSnap = await tryAutoRecoverBlockedTerminal(snap, lastExecutedCommand);
        if (recoveredSnap) {
          autoRunningRef.current = false;
          const editorRetryDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 400, 150);
          setTimeout(() => runAutoStep(recoveredSnap), editorRetryDelay);
          return;
        }
      }
    }

    if (!editorType && isStillRunning && (isStdinBlockingCommand(lastExecutedCommand) || isInteractiveReplCommand(lastExecutedCommand))) {
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      const timeSinceCommand = Date.now() - (lastCommandSentAtRef.current || 0);
      if (idleFor > 1200 || timeSinceCommand > 2500) {
        const recoveredSnap = await tryAutoRecoverBlockedTerminal(snap, lastExecutedCommand);
        if (recoveredSnap) {
          autoRunningRef.current = false;
          const replRetryDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 400, 150);
          setTimeout(() => runAutoStep(recoveredSnap), replRetryDelay);
          return;
        }
      }
    }

    // ── Pre-AI Dynamic Blocker Recovery ───────────────────────────────────────
    // Safety net: if the terminal is still in a recoverable blocking state (e.g.
    // an installer printed "Press ENTER to continue" after command execution,
    // or a confirm prompt appeared unexpectedly), auto-dismiss it here before
    // calling the AI. This prevents wasting an AI turn on a state we can handle.
    {
      const preSnap = getOutputContext();
      const preBlocker = detectInteractivePrompt(preSnap);
      if (preBlocker) {
        const recovery = DYNAMIC_BLOCKER_RECOVERY[preBlocker.kind];
        if (recovery) {
          // Increment counter for this blocker kind; reset on kind change
          if (autoBlockerRef.current.kind === preBlocker.kind) {
            autoBlockerRef.current.count += 1;
          } else {
            autoBlockerRef.current = { kind: preBlocker.kind, count: 1 };
          }

          if (autoBlockerRef.current.count <= 3) {
            // Still worth trying — send recovery input and re-run the step
            // Exception: sudo_password — if empty-enter didn't work on the first try,
            // stop immediately and let the AI configure NOPASSWD instead of re-prompting.
            const sudoFailed = preBlocker.kind === 'sudo_password' && autoBlockerRef.current.count > 1;
            if (!sudoFailed) {
              console.log(`[AI Agent] Pre-AI unblock attempt ${autoBlockerRef.current.count}/3: "${preBlocker.kind}" → ${recovery.label}`);
              socketRef.current?.emit('ssh:input', recovery.action);
              await new Promise(r => setTimeout(r, recovery.waitMs));
              const unblockSnap = getOutputContext();
              autoRunningRef.current = false;
              const unblockRetryDelay = Math.max((adaptiveWaitRef.current?.avgCommandTime || 0.5) * 300, 100);
              setTimeout(() => runAutoStep(unblockSnap), unblockRetryDelay);
              return;
            }
          }

          // 4th+ consecutive failure for same blocker — fall through to the AI
          // with an informative note in the prompt. Reset counter so the next
          // blocker encountered gets a fresh set of attempts.
          console.warn(`[AI Agent] Auto-unblock gave up after 3 attempts for: ${preBlocker.kind}. Handing off to AI.`);
          autoBlockerRef.current = { kind: null, count: 0 };
        }
      } else {
        // No blocker detected — reset the counter
        autoBlockerRef.current = { kind: null, count: 0 };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    autoRunningRef.current = true;
    try {
      // Build rich failure context from recent command history
      const recentHistory = autoRecentCommandsRef.current.slice(-5).join(' → ');
      const failureNote = autoRepeatSigRef.current.count > 0
        ? `\n- REPEATED FAILURE (${autoRepeatSigRef.current.count}x): The last approach did not work. You MUST try a completely DIFFERENT approach. Do NOT repeat the same command.`
        : '';
        
      let runningNote = '';
      if (editorType) {
        runningNote = `\n- ALERT: Terminal is in a PAGER (${editorType}). You MUST press 'q' to quit or 'ENTER' to scroll. Use <command>q</command> or <command>[Wait]</command>.`;
      } else if (interactive) {
        runningNote = `\n- ALERT: INTERACTIVE PROMPT DETECTED (${interactive.kind}). Use the <command> tag to answer it (e.g. <command>y</command> or <command>password</command>).`;
      } else if (isStillRunning) {
        runningNote = `\n- ⛔ HARD BLOCK: The terminal is STILL RUNNING the previous command (no shell prompt visible). You MUST output <command>[Wait]</command> — sending ANY other command now will corrupt the terminal. Package installs can be silent for minutes. Keep waiting.`;
      }

      // === OS / Package Manager Detection (persistent across steps) ===
      const osFromSnap = isMacOs => isMacOs ? 'macOS (Darwin)'
        : /amazon\s*linux|amzn|ec2-user@/i.test(snap) ? 'Amazon Linux'
        : /ubuntu|debian/i.test(snap) ? 'Ubuntu/Debian'
        : /centos|rhel|red hat/i.test(snap) ? 'CentOS/RHEL'
        : /fedora/i.test(snap) ? 'Fedora'
        : /alpine/i.test(snap) ? 'Alpine Linux'
        : /arch linux/i.test(snap) ? 'Arch Linux'
        : null;
      const isMacOs = /darwin|macos|mac os x|apple m[0-9]|homebrew|sw_vers|ProductName:\s*mac/i.test(snap);
      const isAmazonLinux = /amazon\s*linux|amzn|ec2-user@/i.test(snap);
      const freshOs = osFromSnap(isMacOs);
      if (freshOs && !detectedOsRef.current) detectedOsRef.current = freshOs;
      if (isMacOs && detectedOsRef.current !== 'macOS (Darwin)') detectedOsRef.current = 'macOS (Darwin)';
      if (isAmazonLinux && detectedOsRef.current !== 'Amazon Linux') detectedOsRef.current = 'Amazon Linux';
      const detectedOs = detectedOsRef.current;
      const osNote = detectedOs ? `\n- OS: ${detectedOs}` : '';
      const isRootContainer = /root@[a-f0-9]+:.*?#\s*$/im.test(snap);

      const macOsRule = (!isRootContainer && (detectedOs === 'macOS (Darwin)' || isMacOs))
        ? `\n- CRITICAL: This is macOS. NEVER use apt-get, apt, yum, dnf, snap or rpm. Use 'brew' (Homebrew) ONLY. If brew is unavailable, install it first.`
        : '';
      const amazonLinuxRule = (!isRootContainer && (detectedOs === 'Amazon Linux' || isAmazonLinux))
        ? `\n- CRITICAL: This is Amazon Linux. NEVER use apt-get or apt. Use 'yum' ONLY. Example: sudo yum install -y docker`
        : '';
      const rootContainerRule = isRootContainer
        ? `\n- CRITICAL: You are running as ROOT inside a container. Do NOT use 'sudo' (it is not installed and will cause 'command not found' errors). Just run commands directly (e.g. 'apt update', not 'sudo apt update'). Also IGNORE host OS package manager rules—you are in a container. Use apt/yum directly.`
        : '';

      const effectivePreferSudo = sshAiPrefs?.preferSudo && !isRootContainer;

      // FORCE AUTOMATIC WAIT: Never call the AI while a command is still running unless interaction
      // (y/n prompt, password, pager) is explicitly needed. Keep polling until the shell prompt returns.
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      const isInteractionNeeded = err || detectInteractivePrompt(snap) || looksLikeEditorOrPager(snap);
      
      // Use shared isHeavyCommand helper
      const cmdLower = String(lastExecutedCommand || '');
      const isHeavy = isHeavyCommand(cmdLower);

      // HARD WAIT: if the terminal still has no shell prompt AND no interaction is needed,
      // ALWAYS wait and retry — never call the AI regardless of how long idle has been.
      // This is the core fix: the AI must NEVER send a new command while the previous one is running.
      if (!isInteractionNeeded && isStillRunning) {
        markTerminalBusy();
        const waitTime = calculateDynamicWait(isHeavy, false, false);
        setAutoCountdown(Math.ceil(waitTime));
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          runAutoStep();
        }, waitTime * 1000);
        autoRunningRef.current = false; // Allow the timed retry to run
        return;
      }

      // === Goal intent detection (for safety guard below) ===
      const goalLower = String(goal || '').toLowerCase();
      const isRemoveGoal = /\b(remove|uninstall|delete|purge|deinstall|get rid of|clean up)\b/.test(goalLower);
      const isInstallGoal = /\b(install|setup|set up|deploy|add|enable)\b/.test(goalLower) && !isRemoveGoal;

      // Smart context: try to extract ONLY output after last command (saves tokens & reduces stale context)
      
      const postCmdContext = extractPostCommandContext(snap, lastExecutedCommand);
      const contextToSend = postCmdContext.trim().length > 50 ? postCmdContext : snap;

      // Use ONLY the recent output for success detection, avoiding false positives from old scrollback!
      const recentOutputLower = String(postCmdContext || '').toLowerCase();

      // Detect if the goal is an execution/deployment task (needs SSH commands, not file patches).
      const isExecutionGoal = /\b(deploy|start|run|pm2|npm\s+run|npm\s+start|docker|docker-compose|systemctl|nginx|apache|gulp|make|build|serve|launch|restart|reload|install|clone|pull|push|migrate|seed|test|jest|pytest|mocha)\b/i.test(goalLower);

      const stepsDone = Array.isArray(autoStepHistory) ? autoStepHistory.length : 0;

      const isDeployGoal = isExecutionGoal && /\b(deploy|pm2|start|serve|launch|run|docker|systemctl)\b/i.test(goalLower);
      const completionEvidence = inferDynamicCompletionEvidence({
        goal,
        output: postCmdContext || snap,
        lastCommand: lastExecutedCommand,
        err,
        isStillRunning,
        stepsDone,
      });
      // 🛡️ DEEP SCAN GATE: Before sending a "goal satisfied" hint to the AI,
      // verify that the FULL terminal output has no critical errors.
      // This prevents the hint from being sent when errors like GLIBC/docker have scrolled off.
      let completionHint = '';
      if (completionEvidence.done) {
        const deepErrForHint = deepScanTerminalErrors(snap, goal);
        if (deepErrForHint) {
          completionHint = `\n[WARNING] COMPLETION_VETOED: Evidence looked positive but deep scan found critical error: "${deepErrForHint.label}". Do NOT set <done>true</done>. Fix this error first.`;
          console.warn('[AI Agent] Suppressed completion hint due to deep scan error:', deepErrForHint.label);
        } else {
          completionHint = `\n[ACTION] TERMINAL_EVIDENCE_POSITIVE: Goal satisfied (Reason: ${completionEvidence.reason}). Set <done>true</done> now.`;
        }
      }

      // Low-steps warning (disabled in infinite mode)
      const lowStepsWarn = (Number.isFinite(autoStepsRemaining) && autoStepsRemaining <= 5)
        ? `\n- WARNING: Only ${autoStepsRemaining} steps remaining. Prioritize finishing or verifying. Set <done>true</done> if goal is met.`
        : '';

      const progressLine = Number.isFinite(MAX_AUTO_STEPS)
        ? `Progress: ${MAX_AUTO_STEPS + 1 - autoStepsRemaining}/${MAX_AUTO_STEPS}.`
        : `Progress: ${stepsDone + 1}/∞.`;

      const isReadOnlyCommand = (cmd) => {
        const s = String(cmd || '').trim().toLowerCase();
        if (!s) return false;
        // 🧪 If the command redirects output to a file or pipes to tee, it is a WRITE command!
        if (/>|>>/.test(s) || /\|\s*tee\b/.test(s)) return false;

        // Read-only includes status/verification commands. These are safe to repeat and shouldn't trigger loop stops.
        if (/^(cat|head|tail|grep|rg|sed\s+-n|awk|cut|ls|stat|wc|find|test|\[)/.test(s)) return true;

        // Process / service status
        if (/^ps\b/.test(s)) return true;
        if (/^(top|htop)\b/.test(s)) return true;
        if (/^systemctl\s+(status|is-active|is-enabled|show|list-units|list-unit-files)\b/.test(s)) return true;
        if (/^service\s+\S+\s+status\b/.test(s)) return true;
        if (/^journalctl\b/.test(s) && /--no-pager|-n\s+\d+|-u\s+\S+/.test(s)) return true;

        // Nginx verification
        if (/^nginx\s+-t\b/.test(s)) return true;

        // PM2 verification
        if (/^pm2\s+(list|ls|status|show|describe|env|ping)\b/.test(s)) return true;
        if (/^pm2\s+logs\b/.test(s) && /--lines\s+\d+/.test(s)) return true;

        // Network checks
        if (/^(ss|netstat)\b/.test(s)) return true;
        if (/^lsof\b/.test(s)) return true;
        if (/^curl\b/.test(s)) return true;
        if (/^(nc|netcat)\b/.test(s)) return true;
        if (/^(ping|traceroute|mtr)\b/.test(s)) return true;
        if (/^(dig|nslookup)\b/.test(s)) return true;

        // System resource checks
        if (/^(df|du|free|uptime|whoami|id|uname|lsb_release)\b/.test(s)) return true;

        return false;
      };

      // Detect if the goal is an execution/deployment task that needs shell commands, not file patches.
      // When this is true, we suspend the patch-first constraint so the AI can freely run SSH commands.

      // Inject @mentioned file targets so the AI uses exact absolute paths in diff headers
      const _mentionedInGoal = mentionedFilesRef.current || [];
      const mentionedPathsRule = _mentionedInGoal.length > 0
        ? `\n- TARGET FILE${_mentionedInGoal.length > 1 ? 'S' : ''} (from @mention): ${_mentionedInGoal.join(', ')}\n  ⚠️  CRITICAL: Use these EXACT absolute paths in every <diff> header (--- path / +++ path). Never use bare filenames or relative paths.\n`
        : '';

      const patchFirstAutoRules = (sshAiPrefs?.aiTask === 'code' && sshAiPrefs?.enforcePatch !== false && !isExecutionGoal)
        ? `\nPATCH-FIRST AUTO RULES (CODE EDIT MODE):\n- This is a CODE EDITING session. Use <command> ONLY for reading files (cat/head/tail/grep/ls/stat).\n- After reading the relevant files, produce a <diff> patch. Do NOT use sed/tee/printf/nano to write files.\n- To CREATE a new file, prefer using a single heredoc command: \`cat << 'EOF' > filename\` (quoted delimiter). Use <diff> for EDITS.\n${mentionedPathsRule}`
        : (sshAiPrefs?.aiTask === 'code' && isExecutionGoal
          ? `\nNOTE: This is a DEPLOYMENT/EXECUTION task. Run shell commands (pm2, npm, git). To CREATE a new file (nginx.conf, Dockerfile), use \`cat << 'EOF' > filename\`. Ensure 'EOF' is quoted to prevent variable expansion ($var). Use <diff> mainly for EDITING existing files.\n${mentionedPathsRule}`
          : '');

      const recentReadOnlyCount = (autoRecentCommandsRef.current || []).slice(-6).filter(isReadOnlyCommand).length;
      // Only force-diff if we are in code-edit mode AND this is NOT an execution goal
      const forceDiffNowRule = (sshAiPrefs?.aiTask === 'code' && sshAiPrefs?.enforcePatch !== false && !isExecutionGoal && recentReadOnlyCount >= 2)
        ? `\nIMPORTANT: You have already performed enough reads. STOP issuing read commands and output ONLY a <diff> patch now. Leave <command> empty.`
        : '';

      // === Scout-first: detect if this is the very first step for an execution goal ===
      // If the AI has run zero commands yet, it should explore before executing.
      const isFirstStep = !lastExecutedCommand || String(lastExecutedCommand).trim() === '';
      const scoutFirstRule = (isExecutionGoal && isFirstStep)
        ? `\n🔍 SCOUT FIRST (Step 1): Before running ANY execution command, you MUST verify prerequisites:\n- Run \`ls\` or \`ls -la\` to see the folder structure\n- If deploying a Node app, check \`cat package.json | head -20\` to find the start script\n- Check if \`node_modules\` exists (if not, run npm install first)\n- Identify the correct working directory and entry point BEFORE running pm2/npm/docker\n- Do NOT run pm2 start until you have confirmed the app structure is ready\n`
        : '';

      // === Failure reasoning: structured exit vs retry decision ===
      const hasError = !!err;
      const errorRootCauseRule = hasError
        ? (() => {
            const rule = ERROR_RECOVERY_RULES[err?.type] ?? ERROR_RECOVERY_RULES.generic_error;
            return `\n⚠️ ERROR RECOVERY [${err?.label ?? 'Unknown error'}]:\n- ROOT CAUSE HINT: ${rule}\n${ERROR_RECOVERY_FOOTER}\n`;
          })()
        : '';

      // Build skills context block injected into every step
      const _skills = preloadedSkillsRef.current;
      const skillsInjected = Array.isArray(_skills) && _skills.length > 0;
      if (skillsInjected) {
         console.log(`[AI Agent] Injecting ${_skills.length} skills into prompt:`, _skills.map(s => s.name));
      }
      const skillsBlock = skillsInjected
        ? `\n[Skills] Matched: ${_skills.map(s => s.name).join(', ')}\n` +
          _skills.map(s =>
            s.content
              ? `--- Skill: ${s.name} ---\n${String(s.content).slice(0, 2000)}\n`
              : ''
          ).filter(Boolean).join('\n')
        : '';
        
      // --- Version Mismatch Discovery ---
      const outputText = String(contextToSend || '').toLowerCase();
      const hasVersionMismatch = /version\s+[`"']glibc_\d+\.\d+[`"']\s+not\s+found/i.test(outputText) || 
                                /requires\s+glibc_\d+\.\d+/i.test(outputText) ||
                                /not\s+found\s+\(required\s+by/i.test(outputText);
      const versionMismatchHint = hasVersionMismatch
        ? `\n⚠️ CRITICAL: I see a GLIBC/Version library mismatch error.
Root Cause: The pre-built binary is incompatible with this server's libraries.
Solution: You MUST rebuild from source or use a static build. 
Strategy: Try \`cargo build --release\` locally on the server, or if using Rust, add the MUSL target: \`rustup target add x86_64-unknown-linux-musl && cargo build --release --target x86_64-unknown-linux-musl\`.\n`
        : '';

      const preventSearchRule = skillsInjected
        ? `\n7. SKILLS INJECTED: You have matched skills above. DO NOT use <search_skills> again. Use the content provided in [Skills] to solve the goal.`
        : '';

      const autoPrompt = `[AUTO] Goal: ${goal}
State:
- Status: ${terminalStatus}${runningNote}${osNote}${macOsRule}${amazonLinuxRule}${rootContainerRule}${completionHint}${lowStepsWarn}${versionMismatchHint}
- Sudo: ${effectivePreferSudo ? 'on' : 'off'} | Cmd: ${lastExecutedCommand || '(first step)'} | Err: ${err ? err.label : 'none'}${failureNote}
- Recent: ${recentHistory || 'none'}${skillsBlock}
- Output:
${String(contextToSend || '(no output)').slice(-1500)}
${isExecutionGoal ? '⚡ EXECUTION: run commands directly.\n' : ''}${scoutFirstRule}${errorRootCauseRule}${preventSearchRule || ''}${patchFirstAutoRules}${forceDiffNowRule}Step ${stepsDone + 1}${Number.isFinite(autoStepsRemaining) && autoStepsRemaining <= 5 ? ` (${autoStepsRemaining} left — wrap up)` : ''}.${autoPromptExpansion}`;

      // Add to conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'user', content: autoPrompt }
      ].slice(-6); // Tight history: 6 turns is enough when output is present

      const res = await apiFetch('/api/ssh/ai-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: autoPrompt + nudgeMsg,
          context: String(snap || '').slice(-2500),
          contextPack: buildAiContextPack(snap),
          connectionName,
          host,
          prefs: sshAiPrefs,
          model: sshAiPrefs.aiModel || 'auto',
          tmuxActive: !!sshAiPrefs?.autoTmux,
          history: aiConversationRef.current.slice(-12),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.error && /limit|quota|exceeded/i.test(data.error)) {
          setAiLimitHit(true);
          setAiLimitGoal(goal);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          setAiError(null);
          return;
        }
        throw new Error(data.error || 'AI request failed');
      }

      apiRetryCountRef.current = 0; // Reset on success

      const parsed = parseAiAnswer(data.answer, { usedModel: data.usedModel });
      setAiAnswer(parsed);
      
      // Update step history for the UI
      if (parsed.command) {
        setAutoStepHistory(prev => [...prev, {
          command: parsed.command,
          explain: parsed.explain || 'Executing command...',
          status: parsed.done ? 'success' : 'running'
        }].slice(-10)); // Keep last 10 steps in view

      }

      // Track AI response — keep only last 12 turns
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'assistant', content: data.answer }
      ].slice(-12);

      // === AI says DONE (success) ===
      if (parsed.done) {
        // 🛡️ VETO LOGIC: If the terminal contains a critical error matching the goal,
        // do NOT allow the model to finish. It's likely hallucinating completion.
        const currentSnap = getOutputContext();
        const activeErr = detectTerminalError(currentSnap);
        
        // 🛡️ DEEP SCAN: Also scan the FULL output for critical errors that might have
        // scrolled past the last-20-lines window (e.g. GLIBC errors after `find` output)
        const deepErr = deepScanTerminalErrors(currentSnap, goal);
        const effectiveErr = activeErr || deepErr;
        
        // Check if the error is relevant to the goal (e.g. goal contains "zeroclaw" and output has a zeroclaw error)
        const goalLower = String(goal || '').toLowerCase();
        const outputLower = String(currentSnap || '').toLowerCase();
        const isGoalRelevant = goalLower.split(/\s+/).some(w => w.length > 3 && outputLower.includes(w));

        const isActionGoal = /\b(install|fix|run|setup|start|deploy|update|build|create)\b/i.test(goalLower);
        const isDiscoveryCmd = lastExecutedCommand && /^(\s*sudo\s+)?(\bls\b|\bfind\b|\bpwd\b|\bcat\b)/.test(lastExecutedCommand);

        // 🛡️ DOCKER VETO: If goal mentions docker, require a docker command for verification
        const goalHasDocker = goalLower.includes('docker');
        const isDockerCmd = (cmd) => /(?:^|[;&|]\s*|\$\(\s*)(?:sudo\s+)?(?:[\/\w-]+\/)?(docker|docker-compose)\b/i.test(String(cmd || ''));
        const lastCmdHasDocker = isDockerCmd(lastExecutedCommand);
        // Check if ANY docker command was run in recent history (not just last command)
        const recentCmdsHaveDocker = autoRecentCommandsRef.current?.some(isDockerCmd) || false;
        // Check if Dockerfile was created but no docker build/run happened
        const createdDockerfileOnly = (outputLower.includes('dockerfile') || String(lastExecutedCommand || '').toLowerCase().includes('dockerfile')) && 
          !recentCmdsHaveDocker && !lastCmdHasDocker;
        const dockerVeto = goalHasDocker && !lastCmdHasDocker && !recentCmdsHaveDocker;
        const dockerfileOnlyVeto = goalHasDocker && createdDockerfileOnly;

        const shouldVeto = (effectiveErr && (effectiveErr.severity === 'critical' || effectiveErr.severity === 'high') && isGoalRelevant) ||
                           (effectiveErr && effectiveErr.severity === 'critical') ||
                           (isActionGoal && isDiscoveryCmd && !outputLower.includes('success') && !outputLower.includes('installed')) ||
                           dockerVeto ||
                           dockerfileOnlyVeto;

        if (shouldVeto) {
          const vetoReason = effectiveErr
            ? `Critical error detected: ${effectiveErr.label}`
            : dockerfileOnlyVeto
              ? `Dockerfile created but no docker build/run executed`
              : dockerVeto
                ? `Goal requires Docker but no docker command was run`
                : `Found files but haven't verified the goal yet`;

          console.warn('[AI Agent] Vetoing premature completion. Reason:', vetoReason);
          setAiError(`Goal potentially not reached: ${vetoReason}. Retrying...`);

          // Nudge the AI specifically about the error and its premature exit
          const nudge = effectiveErr
            ? `\n\n⚠️ REJECTED: You set <done>true</done> but the terminal shows an error: "${effectiveErr.label}". \nYou MUST fix this error before finishing. The goal is NOT met.`
            : dockerfileOnlyVeto
              ? `\n\n⚠️ REJECTED: You set <done>true</done> but you only created a Dockerfile. You MUST run 'docker build' and 'docker run' to complete a Docker-related goal.`
              : dockerVeto
                ? `\n\n⚠️ REJECTED: You set <done>true</done> but the goal mentions "docker" and no docker command was run. You must run 'docker build', 'docker run', or verify via 'docker ps' before finishing.`
                : `\n\n⚠️ REJECTED: You set <done>true</done> after an 'ls' or discovery command. Simply seeing a file or folder is NOT evidence that the goal (e.g. installation/fix) is complete. You MUST verify that the tool actually works (e.g. check version, run status) before you are done.`;

          const nudgeWait = calculateDynamicWait(false, false, false);
          recordWait(nudgeWait);
          setTimeout(() => runAutoStep(currentSnap, nudge), nudgeWait * 1000);
          return;
        }

        // If AI also sent a command with done=true, execute it first then show modal
        if (parsed.command) {
          console.warn('[AI Agent] Model executed a command while setting done=true. Executing command, but also marking as done.');
          // Execute the command
          const newSnap = await executeCommandAndCapture(parsed.command);
          // Show done modal after command executes
          const doneWait = calculateDynamicWait(false, false, false);
          setTimeout(() => {
            showAiDoneModal({
              goal,
              steps: autoStepHistory,
              taskMode: sshAiPrefs.aiTask || 'ssh',
              thought: parsed.thought || null,
              explain: parsed.explain || 'Task complete.',
            });
          }, doneWait * 1000);
        } else {
                  // ✅ Save completed session to sshAiHistory
          // NOTE: Do NOT call showAiDoneModal inside the setAutoStepHistory updater.
          // We compute finalSteps using the current state and schedule side effects outside.
          const finalSteps = [...autoStepHistory, {
            command: '',
            explain: parsed.explain || 'Task complete.',
            status: 'success',
          }];

          setAutoStepHistory(finalSteps);

          // Schedule side effects outside the state updater
          setTimeout(() => {
            setAiDone(true); // Ensure state updates forcefully
            showAiDoneModal({
              goal,
              steps: finalSteps.slice(-30),
              taskMode: sshAiPrefs.aiTask || 'ssh',
              thought: parsed.thought || null,
              explain: parsed.explain || null,
            });
            const sessionEntry = {
              id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
              createdAt: Date.now(),
              type: 'auto',
              prompt: goal,
              steps: finalSteps.slice(-30),
              done: true,
            };
            setSshAiHistory(prev2 => [sessionEntry, ...prev2.filter(e => e?.id !== sessionEntry.id)].slice(0, 30));
          }, 50);

          return;
        }
      }

      // === AI says DONE=false (graceful failure / gave up) ===
      if (parsed.doneFailed) {
        const failReason = parsed.explain || 'The AI determined the goal cannot be completed in the current server state.';
        setAiError(`❌ Auto Mode stopped: ${failReason}`);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        setAutoStepHistory(prev => [...prev, {
          command: parsed.command || '',
          explain: `${t('ai.failedSmall')}: ${failReason}`,
          status: 'error',
        }]);
        return;
      }

      // === Dangerous command: pause for confirmation ===
      if (parsed.danger) {
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        setExecuteConfirmOpen(true);
        setAiError('Auto Mode paused: dangerous command requires confirmation.');
        setAutoMode(false);
        return;
      }

      // === Interactive command handling: NO pause for sudo/password — engine continues ===
      if (parsed.interactive) {
        const interactiveType = String(parsed.interactive).toLowerCase().trim();

        // 🧪 SELF-HEALING: If the AI literally copied the pipe-separated format example,
        // it means it's hallucinating the template. Clear it to prevent a loop.
        const isExampleTemplate = interactiveType.includes('|') || interactiveType.includes('sudo_password|password');
        if (isExampleTemplate) {
          console.warn('[AI Agent] Detected literal template in <interactive> tag. Clearing.', parsed.interactive);
          parsed.interactive = '';
        }

        // sudo_password / passphrase: do NOT pause — let the engine continue.
        // If the terminal actually shows a password prompt, the reactive interactive UI
        // will catch it. The AI's system prompt already sets up NOPASSWD automatically.
        if (/(sudo_password|passphrase)/i.test(interactiveType)) {
          console.log('[AI Agent] sudo/passphrase interactive hint — NOT pausing, engine continues.', parsed.interactive);
          // Non-blocking warning visible in UI but does not stop execution
          setAiError(`⚠️ Note: command may request sudo/passphrase — handling automatically.`);
          setTimeout(() => setAiError(null), 4000); // auto-dismiss after 4s
        }
      }
      bypassPasswordPauseRef.current = false; // consume any bypass flag

      // === SkillsMP Integration: Search for remote skills (disabled in code mode) ===
      if (parsed.searchSkills && String(parsed.searchSkills).trim() && sshAiPrefs?.aiTask !== 'code') {
        const query = String(parsed.searchSkills).trim();
        console.log('[AI Agent] Searching SkillsMP for:', query);

        // 🧪 Fix for "loop on resume": If the AI also provided a command, EXECUTE IT before pausing!
        // This ensures the AI sees the result of its command when the user resumes, instead of repeating the same step.
        if (parsed.command && String(parsed.command).trim()) {
           const cmd = String(parsed.command).trim();
           // Only run if not empty
           if (cmd) {
             console.log('[AI Agent] Executing command before pausing for skill search:', cmd);
             handleExecuteCommand(cmd);
           }
        }

        setAiError(`Auto Mode paused: Searching for skills relating to "${query}"...`);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        handleSkillsSearch(query);
        return;
      }

      // === Patch-first auto mode: handle <diff> as an executable patch step ===
      // We always accept diffs in Code Editor mode (even for execution goals) so the AI can voluntarily
      // fix a config file (Dockerfile, package.json, ecosystem.config.js) mid-deploy via clean SFTP patch
      // instead of resorting to cat-heredoc or sed inline edits.
      // What's suppressed for execution goals is only the *forcing* rules (patchFirstAutoRules / forceDiffNowRule).
      if (parsed.diff && String(parsed.diff).trim() && (sshAiPrefs?.aiTask === 'code' || sshAiPrefs?.enforcePatch)) {
        const d = String(parsed.diff).trim();
        if (!isValidUnifiedDiff(d)) {
          const hasHunk = d.includes('@@');
          const hasHeader = d.includes('--- ') || d.includes('+++ ');
          
          if (!hasHunk && !hasHeader) {
            // Found plain text caught in a diff tag/block. Do not open the Patch Modal with gibberish.
            setAiError('Auto Mode paused: AI provided conversational text in a <diff> tag instead of a valid patch. Instruct it to use correct formatting.');
            setAutoMode(false);
            setAiOpen(true);
            setAiHasOpenedOnce(true);
            return;
          }

          setPatchModalDiff(d);
          setPatchModalAutoApplied(false);
          setPatchModalOpen(true);
          setAiError('Auto Mode paused: AI returned a malformed diff patch. Please review/copy the patch, then Resume.');
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }
        // If the model repeats the exact same diff, it means the patch already applied
        // but the AI didn't observe the result yet and sent the same patch again.
        // Track repeat count — after 2 repeats, the patch has definitely been applied; force done.
        const patchRepeatKey = `patch::${d.slice(0, 120)}`;
        if (lastAutoAppliedDiffRef.current === d) {
          autoRepeatSigRef.current.count = (autoRepeatSigRef.current.key === patchRepeatKey)
            ? autoRepeatSigRef.current.count + 1
            : 1;
          autoRepeatSigRef.current.key = patchRepeatKey;

          if (autoRepeatSigRef.current.count >= 2) {
            // Patch was already applied — AI is in a loop. Treat as done.
            setTimeout(() => {
              showAiDoneModal({
                goal,
                steps: autoStepHistory,
                taskMode: sshAiPrefs?.aiTask || 'code',
                explain: '✅ Patch was successfully applied. AI confirmed via re-check.',
              });
            }, 0);
            return;
          }

          // First repeat — give it one more chance to confirm and declare done
          setAiError(null);
          const waitSec = calculateDynamicWait(false, false, false);
          setAutoCountdown(Math.ceil(waitSec));
          if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
          autoTimerRef.current = setTimeout(() => {
            autoRunningRef.current = false;
            runAutoStep();
          }, waitSec * 1000);
          return;
        }
        // Reset repeat counter when a new diff appears
        autoRepeatSigRef.current = { key: patchRepeatKey, count: 0 };

        setPatchModalDiff(d);
        setPatchModalOpen(true);

        if (!sshAiPrefs?.autoApplyPatch) {
          setPatchModalAutoApplied(false);
          setAiError('Auto Mode paused: patch requires review. Click Apply Patch, then Resume.');
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }

        // Auto-apply patch with backup, then continue
        // Reuse the session backup ID so only ONE .bak file per file per auto session (no spam)
        if (!autoSessionBackupIdRef.current) autoSessionBackupIdRef.current = Date.now().toString(36);
        lastAutoAppliedDiffRef.current = d;
        const backupId = autoSessionBackupIdRef.current;
        setPatchModalAutoApplied(true);
        setLastPatchResultData(null); // Clear for new run
        setPatchModalOpen(true);

        // Apply via SFTP + diff-match-patch
        applyPatchViaSftp(d, backupId).then((result) => {
          const files = result.files || [];
          setLastPatchBackup({ id: backupId, files });
          setLastPatchResultData(result.results || null);
          if (!result.success) {
            setAiError(`Auto Mode: Patch failed — ${result.error || result.summary || 'Unknown error'}`);
          }
        });

        // Auto-close modal after adaptive delay to keep UI clean
        const modalCloseDelay = Math.min(adaptiveWaitRef.current.currentWait * 1000, 6000);
        setTimeout(() => {
          setPatchModalOpen(prev => {
            if (prev && lastAutoAppliedDiffRef.current === d) return false;
            return prev;
          });
        }, modalCloseDelay);

        // Continue after adaptive delay to let the patch complete
        const waitSec = calculateDynamicWait(false, false, false);
        setAutoCountdown(Math.ceil(waitSec));
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          autoRunningRef.current = false;
          runAutoStep();
        }, waitSec * 1000);
        return;
      }

      const parsedCommandTrim = String(parsed.command || '').trim();
      const redundantFollowupCommand = !!parsedCommandTrim && (
        isReadOnlyCommand(parsedCommandTrim) || /^\[wait\]$/i.test(parsedCommandTrim)
      );

      // === Client-side: dynamic completion guard ===
      if (completionEvidence.done && (!parsedCommandTrim || redundantFollowupCommand)) {
        setTimeout(() => {
          setAiDone(true); // Ensure state updates forcefully
          showAiDoneModal({
            goal,
            steps: autoStepHistory,
            taskMode: sshAiPrefs?.aiTask || 'ssh',
            thought: parsed.thought || null,
            explain: parsed.explain || `✅ Goal already satisfied: ${completionEvidence.reason}.`,
          });
        }, 50);
        return;
      }

      // === No command and not done: AI is stuck (STALL DETECTION) ===
      if (!parsed.command || !String(parsed.command).trim()) {
        const needRetryKey = `${goal}::${lastExecutedCommand || ''}::${snap.slice(-100)}`;
        
        // Use a counter for multiple nudges instead of a single binary ref
        if (!autoEmptyRetryRef.current || !autoEmptyRetryRef.current.startsWith(needRetryKey)) {
          autoEmptyRetryRef.current = `${needRetryKey}:1`;
        } else {
          const count = parseInt(autoEmptyRetryRef.current.split(':').pop()) || 1;
          autoEmptyRetryRef.current = `${needRetryKey}:${count + 1}`;
        }

        const retryCount = parseInt(autoEmptyRetryRef.current.split(':').pop()) || 0;

        if (retryCount <= 2) {
          // 🧪 SELF-HEALING NUDGE: Remind the AI it MUST produce an action
          console.log(`[AI Agent] Nudging talkative AI (attempt ${retryCount}/2)...`);
          
          let nudgeMsg = `\n\n⚠️ STALL WARNING: You provided no action (no <command> or <diff>).
In Auto Mode, every response MUST contain either a <command>, a <diff>, or set <done>true</done>.
You cannot just explain; you must ACT.
- Running diagnostics? Use <command>...command here...</command>.
- Fix required? Use <diff>...patch here...</diff>.
- Already verified the goal? Set <done>true</done>.
What is your move?`;

          // 🛡️ DYNAMIC NUDGE: If the stall was caused because we blocked an error message
          if (parsed.safetyBlocked) {
            nudgeMsg = `\n\n🚨 CRITICAL MISTAKE: You just tried to execute a terminal error message as a bash command!
Do NOT copy-paste error output (like "GLIBC not found", "command not found", or "permission denied") into the <command> tag!
That is not a valid command and will break the terminal. 
You must write a VALID bash command to FIX the error (e.g. 'yum install -y docker' instead of just pasting the error).
What completely valid bash command will you run next?`;
          }
          
          autoRunningRef.current = false;
          const stallWait = calculateDynamicWait(false, false, false);
          recordWait(stallWait);
          if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
          autoTimerRef.current = setTimeout(() => runAutoStep(snap, nudgeMsg), stallWait * 1000);
          return;
        }

        if (sshAiPrefs?.aiTask === 'code') {
          // Code mode: don't search skills — force the AI to produce a diff
          autoRunningRef.current = false;
          const codeStallWait = calculateDynamicWait(false, false, false);
          recordWait(codeStallWait);
          if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
          autoTimerRef.current = setTimeout(() => runAutoStep(snap,
            `\n\n⚠️ STALL (Code Mode): You provided no action. In Code Edit mode you MUST either:\n- Read the file once with <command>cat path</command> if you haven't yet, OR\n- Output a <diff> patch immediately. Do NOT explain; ACT.`
          ), codeStallWait * 1000);
          return;
        }
        // 🧪 SELF-HEALING: If it's a stall but the text LOOKS like completion, treat as done!
        // 🛡️ BUT: Only if the terminal has NO critical errors (deep scan)
        if (looksLikeCompletionText(parsed.explain)) {
          const stallSnap = getOutputContext();
          const stallDeepErr = deepScanTerminalErrors(stallSnap, goal);
          if (stallDeepErr) {
            console.warn('[AI Agent] Stall looks like completion but deep scan found error:', stallDeepErr.label);
            
            // If we've already tried nudging the AI about this error multiple times, give up to prevent infinite loop
            if (retryCount > 2) {
              setAiError(`Auto Mode paused: AI thinks task is done, but there is a critical terminal error ("${stallDeepErr.label}"). Human intervention or new skill needed.`);
              setAutoMode(false);
              setAiOpen(true);
              setAiHasOpenedOnce(true);
              handleSkillsSearch(goal);
              return;
            }

            // Don't force done — nudge the AI about the error
            setTimeout(() => runAutoStep(stallSnap,
              `\n\n⚠️ STALL + ERROR: Your response suggests completion, but the terminal shows a critical error: "${stallDeepErr.label}". This must be fixed before the task can be considered done.`
            ), 1000);
            return;
          }
          console.log('[AI Agent] Stall detected but text looks like completion (no errors). Forcing done.');
          setTimeout(() => {
            showAiDoneModal({
              goal,
              steps: autoStepHistory,
              taskMode: sshAiPrefs?.aiTask || 'ssh',
              explain: parsed.explain || '✅ Task complete (inferred from response).',
            });
          }, 0);
          return;
        }

        const _stallSkillQuery = skillQueryFromGoal(goal, recentOutputLower);
        console.log('[AI Agent] Stall detected — searching SkillsMP for:', _stallSkillQuery);
        setAiError(`Auto Mode paused: AI is stuck. Searching SkillsMP for "${_stallSkillQuery}" skills to help...`);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        handleSkillsSearch(_stallSkillQuery);
        return;
      }

      autoEmptyRetryRef.current = '';

      // === Safety guard: block installs when goal is to remove ===
      const cmdTrimLower = String(parsed.command || '').toLowerCase();
      const isInstallCmd = /\b(install|add|enable|setup)\b/.test(cmdTrimLower) &&
        !/(remove|uninstall|purge|delete)/.test(cmdTrimLower);
      if (isRemoveGoal && isInstallCmd) {
        setAiError('Auto Mode stopped: AI tried to INSTALL when the goal was to REMOVE. This looks like a loop. Please check manually.');
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }

      // === Hard loop guard: same command repeated ===
      // If the model keeps sending the exact same command repeatedly (common for sed/cat edits), stop auto mode.
      const nextCmdTrim = String(parsed.command || '').trim();
      if (nextCmdTrim) {
        if (autoSameCommandRef.current.cmd === nextCmdTrim) {
          autoSameCommandRef.current.count += 1;
        } else {
          autoSameCommandRef.current = { cmd: nextCmdTrim, count: 0 };
        }
        // Guard: same read-only command repeated — in code mode force a diff, otherwise search skills
        if (autoSameCommandRef.current.count >= 2 && isReadOnlyCommand(nextCmdTrim)) {
          if (sshAiPrefs?.aiTask === 'code') {
            // Code mode: don't pause/search — nudge AI to stop cat-looping and produce a patch
            autoSameCommandRef.current = { cmd: '', count: 0 };
            autoRunningRef.current = false;
            if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
            autoTimerRef.current = setTimeout(() => runAutoStep(snap,
              `\n\n⚠️ PATCH NOW (Code Mode): You have read '${nextCmdTrim}' ${autoSameCommandRef.current.count + 3} times. STOP issuing read commands. You already have the file content. Output a <diff> patch immediately to make the edit. Leave <command> empty.`
            ), 800);
            return;
          }
          const _roRepeatSkillQuery = skillQueryFromGoal(goal, recentOutputLower);
          const catMatch = nextCmdTrim.match(/^(cat|head|tail)\s+(.*)/i);
          const wrongPathHint = catMatch ? ` (possible wrong path for '${catMatch[2]}')` : '';
          console.log('[AI Agent] Read-only command repeated', autoSameCommandRef.current.count + 1, 'times — searching SkillsMP for:', _roRepeatSkillQuery);
          setAiError(`Auto Mode paused: AI repeated '${nextCmdTrim}' ${autoSameCommandRef.current.count + 1} times${wrongPathHint}. Searching SkillsMP for "${_roRepeatSkillQuery}" skills...`);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          handleSkillsSearch(_roRepeatSkillQuery);
          return;
        }
        if (autoSameCommandRef.current.count >= 2 && !isReadOnlyCommand(nextCmdTrim)) {
          if (sshAiPrefs?.aiTask === 'code') {
            // Code mode: repeated non-read command — nudge to patch
            autoSameCommandRef.current = { cmd: '', count: 0 };
            autoRunningRef.current = false;
            if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
            autoTimerRef.current = setTimeout(() => runAutoStep(snap,
              `\n\n⚠️ CODE MODE: You repeated the same command. In Code Edit mode, use <diff> to make file changes, not shell commands. Output the patch now.`
            ), 800);
            return;
          }
          const _repeatSkillQuery = skillQueryFromGoal(goal, recentOutputLower);
          console.log('[AI Agent] Repeated command detected — searching SkillsMP for:', _repeatSkillQuery);
          setAiError(`Auto Mode paused: AI repeated the same command. Searching SkillsMP for "${_repeatSkillQuery}" skills to find a better approach...`);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          handleSkillsSearch(_repeatSkillQuery);
          return;
        }
      }

      // === Execute a command or diff ===
      setAutoStepsRemaining((n) => (Number.isFinite(n) ? Math.max(0, n - 1) : n));
      const cmdTrim = String(parsed.command || '').trim();
      
      // 🧪 SENSITIVE OPERATIONS GUARD (Auto Mode)
      // Pause if setting is enabled and command is dangerous OR AI explicitly flagged it
      const confirmSensitive = sshAiPrefs?.confirmSensitive !== false;
      const isDangerous = (confirmSensitive && isSensitiveCommand(cmdTrim)) || parsed.danger === true;
      
      if (isDangerous && cmdTrim) {
        console.log('[AI Agent] PAUSED: Detected sensitive command in Auto Mode:', cmdTrim);
        setAiError(`Auto Mode paused: AI proposed a sensitive command. Please review and execute manually if safe.`);
        setAiAnswer(parsed);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        // Note: we leave the command in the UI so the user can click 'Run' themselves.
        return;
      }

      if (cmdTrim) {
        autoRecentCommandsRef.current = [...autoRecentCommandsRef.current, cmdTrim].slice(-8);
        autoRecentSigsRef.current = [...autoRecentSigsRef.current, computeErrorSignature(snap)].slice(-8);

        // === Read-only saturation detector ===
        // If the last 4+ commands are ALL read-only (cat, ls, head, grep, etc.)
        // the AI is stuck gathering info without acting — trigger skill search.
        const recentCmds = autoRecentCommandsRef.current;
        if (recentCmds.length >= 4) {
          const lastFour = recentCmds.slice(-4);
          const allReadOnly = lastFour.every(c => isReadOnlyCommand(c));
          if (allReadOnly) {
            const _roSkillQuery = skillQueryFromGoal(goal, recentOutputLower);
            console.log('[AI Agent] Read-only saturation (4+ consecutive read-only commands) — searching SkillsMP for:', _roSkillQuery);
            setAiError(`Auto Mode paused: AI ran ${lastFour.length} read-only commands without taking action. Searching SkillsMP for "${_roSkillQuery}" skills...`);
            setAutoMode(false);
            setAiOpen(true);
            setAiHasOpenedOnce(true);
            handleSkillsSearch(_roSkillQuery);
            return;
          }
        }

        // === Command cycle detector (A→B→A→B pattern) ===
        // Lowered threshold from 6 to 4 commands — catches cycles faster.
        // Now also catches read-only command cycles (previously excluded).
        if (recentCmds.length >= 4) {
          const a = recentCmds[recentCmds.length - 1];
          const b = recentCmds[recentCmds.length - 2];
          const c = recentCmds[recentCmds.length - 3];
          const d = recentCmds[recentCmds.length - 4];
          if (a === c && b === d && a !== b) {
            const _cycleSkillQuery = skillQueryFromGoal(goal, recentOutputLower);
            console.log('[AI Agent] Command cycle detected — searching SkillsMP for:', _cycleSkillQuery);
            setAiError(`Auto Mode paused: AI is cycling commands (${a} ↔ ${b}). Searching SkillsMP for "${_cycleSkillQuery}" skills to break the loop...`);
            setAutoMode(false);
            setAiOpen(true);
            setAiHasOpenedOnce(true);
            handleSkillsSearch(_cycleSkillQuery);
            return;
          }
        }
      }
      const newSnap = await executeCommandAndCapture(parsed.command);

      // After the command resolves, decide what to do next:
      // — If the terminal is still running (busy/stuck), let runAutoStep's own wait logic
      //   handle the re-poll. We DO NOT schedule the next AI call immediately here.
      // — If the terminal returned to a shell prompt, schedule the next AI step directly
      //   from here (avoids the 50ms useEffect race).
      if (!autoModeRef.current) return; // auto mode was cancelled during command

      const snapAfter = newSnap ?? getOutputContext();
      const isStillBusy = !looksLikeShellPrompt(snapAfter);

      if (isStillBusy) {
        // Command did not exit — let runAutoStep's existing idle-wait logic handle it:
        // update snapshot and trigger the polling useEffect normally.
        setLastResultSnapshot(snapAfter);
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });
      } else {
        // Command exited cleanly — schedule next AI step directly with a short delay.
        // (The lastResultAt useEffect will also fire, but autoRunningRef.current will be
        //  false by then and the duplicate call will be blocked at the top of runAutoStep.)
        setLastResultSnapshot(snapAfter);
        resetAdaptiveWait(); // Reset wait time since command completed successfully
        autoRunningRef.current = false; // release lock before scheduling
        setAutoCountdown(1);
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          runAutoStep(snapAfter);
        }, 1000); // 1s breathing room after command exits
        return;
      }

    } catch (e) {
      if (apiRetryCountRef.current < 2) {
        apiRetryCountRef.current += 1;
        console.warn(`AI API failed, retrying (${apiRetryCountRef.current}/3)...`, e);
        const waitSec = calculateDynamicWait(false, false, true);
        setAutoCountdown(Math.ceil(waitSec));
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          runAutoStep(snap);
        }, waitSec * 1000);
        return;
      }
      setAiError(e.message);
      setAutoMode(false);
      apiRetryCountRef.current = 0;
    } finally {
      autoRunningRef.current = false;
    }
  };

  // Scroll to bottom when AI content updates
  useEffect(() => {
    if (aiPanelContentRef.current) {
      aiPanelContentRef.current.scrollTop = aiPanelContentRef.current.scrollHeight;
    }
  }, [aiAnswer, aiError, interactivePrompt, autoCountdown, executeConfirmOpen]);

  // Reactive Safety Net: If the AI Answer indicates it's done but the modal didn't open, force it.
  useEffect(() => {
    if (aiAnswer?.done && !aiDone) {
      const timer = setTimeout(() => {
        if (!aiDone && aiAnswer?.done) {
          showAiDoneModal({
            goal: autoGoal || aiPrompt || 'Task complete',
            steps: autoStepHistory || [],
            taskMode: sshAiPrefs?.aiTask || 'ssh',
            explain: aiAnswer?.explain || null,
            thought: aiAnswer?.thought || null
          });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [aiAnswer?.done, aiDone, autoGoal, aiPrompt, autoStepHistory, sshAiPrefs]);

  useEffect(() => {
    if (aiMode !== 'auto') return;
    if (!autoMode) return;
    if (!lastResultAt) return;
    // Guard: never trigger a new AI step while a command is still actively running.
    // executeCommandAndCapture sets commandRunningRef.current = true for its entire duration;
    // when the command finishes AND exits cleanly it schedules the next step directly.
    // This effect only serves as the fallback trigger (e.g. manual refresh, editor exit).
    if (commandRunningRef.current) return;

    setAutoCountdown(0);
    const timer = setTimeout(() => {
      runAutoStep(lastResultSnapshot);
    }, 200); // Slightly longer debounce to avoid double-fire with the direct schedule above

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, autoMode, lastResultAt]);

  // Countdown timer logic
  useEffect(() => {
    if (autoCountdown <= 0) return;
    const timer = setInterval(() => {
      setAutoCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [autoCountdown]);

  useEffect(() => {
    if (aiMode === 'manual' && autoMode) {
      setAutoMode(false);
    }
  }, [aiMode, autoMode]);

  const handleInsertCommand = (cmd) => {
    const command = String(cmd || '').replace(/[\r\n]+$/g, '');
    if (!command) return;
    if (socketRef.current?.connected) {
      socketRef.current.emit('ssh:input', command);
      termInstanceRef.current?.focus();
      return;
    }
    if (termInstanceRef.current) {
      termInstanceRef.current.focus();
    }
  };

  const handleExecuteCommand = (cmd, bypassSensitive = false) => {
    const command = String(cmd || '').replace(/[\r\n]+$/g, '');
    if (!command) return;
    
    // Check for sensitive operations if confirmation is enabled
    // Skip check for patch commands (they are safe, system-managed operations)
    const confirmSensitive = sshAiPrefs?.confirmSensitive !== false; // default true
    const isPatchCmd = command.startsWith('backup_id=') || command.includes('PATCH_EOF') || command.includes('patch_') || bypassSensitive;
    if (confirmSensitive && isSensitiveCommand(command) && !autoMode && !isPatchCmd) {
      setPendingSensitiveCommand(command);
      setSensitiveConfirmOpen(true);
      return;
    }
    
    executeCommandInternal(command);
  };

  const executeCommandInternal = (command) => {
    // 🚨 LAST-LINE SAFETY: Never send error messages to the terminal
    // The AI sometimes puts error output into <command> tags by mistake.
    // Backticks in GLIBC errors (e.g. `GLIBC_2.39') break bash with unmatched quotes.
    if (/GLIBC_\d|\/lib(?:64)?\/.*\.so.*:\s|not found \(required by|Traceback \(most recent call last\)/i.test(command)) {
      console.error('[AI Agent] 🚨 BLOCKED execution of error message:', command.slice(0, 100));
      return;
    }
    
    setLastExecutedCommand(command);
    if (socketRef.current?.connected) {
      if (/^\[?ctrl\+c\]?$|^\^c$/i.test(command)) {
        socketRef.current.emit('ssh:input', '\x03');
      } else {
        socketRef.current.emit('ssh:input', `${command}\n`);
      }
      termInstanceRef.current?.focus();
      setTimeout(() => {
        const snap = getOutputContext();
        setLastResultSnapshot(snap);
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });

        maybeHandleInteractivePrompt(snap);
      }, 700);
      return;
    }
    if (termInstanceRef.current) {
      termInstanceRef.current.focus();
    }
  };

  // Auto-reconnect when vault unlocks (dbUri goes from empty → populated)
  useEffect(() => {
    const newUri = appState.dbConfig?.uri || '';
    const prevUri = termDbUriRef.current;
    termDbUriRef.current = newUri;
    if (newUri && !prevUri && (termStatusRef.current === 'error' || termStatusRef.current === 'connecting')) {
      console.log('🔓 Vault unlocked — retrying SSH terminal connection');
      setReconnectNonce(n => n + 1);
    }
  }, [appState.dbConfig?.uri]);

  useEffect(() => {
    const cleanup = initTerminal();

    return () => {
      if (cleanup && typeof cleanup.then === 'function') {
        cleanup.then(fn => fn && fn());
      }
      if (socketRef.current) {
        socketRef.current.emit('ssh:disconnect');
        socketRef.current.disconnect();
      }
      if (termInstanceRef.current) {
        termInstanceRef.current.dispose();
        termInstanceRef.current = null;
      }
    };
  }, [initTerminal, reconnectNonce]);

  const handleReconnect = () => {
    try {
      if (socketRef.current) {
        socketRef.current.emit('ssh:disconnect');
        socketRef.current.disconnect();
      }
    } catch (e) {}

    try {
      if (termInstanceRef.current) {
        termInstanceRef.current.dispose();
        termInstanceRef.current = null;
      }
    } catch (e) {}

    setErrorMsg(null);
    setLatency(null);
    setStatus('connecting');
    idleTimedOutRef.current = false;
    setShowReconnect(false);
    setReconnectNonce((n) => n + 1);
  };

  // Re-fit when tab becomes visible (throttled)
  useEffect(() => {
    if (status !== 'connected') return;
    
    const timeout = setTimeout(() => {
      if (fitAddonRef.current && terminalRef.current?.offsetParent) {
        try {
          fitAddonRef.current.fit();
        } catch (e) {}
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [status]); // Only re-fit on status changes or mount

  // Heartbeat loop for latency monitoring
  useEffect(() => {
    let interval;
    if (status === 'connected' && socketRef.current) {
      interval = setInterval(() => {
        if (socketRef.current.connected) {
          socketRef.current.emit('heartbeat:ping', Date.now());
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status]);

  const getStatusInfo = () => {
    switch (status) {
      case 'connecting':
        return { icon: <Loader2 size={12} className="animate-spin" />, text: t('terminal.status.connecting'), color: 'var(--accent-amber)' };
      case 'connected':
        return { icon: <CheckCircle2 size={12} />, text: t('terminal.status.connected'), color: 'var(--accent-emerald)' };
      case 'error':
        return { icon: <AlertCircle size={12} />, text: t('terminal.status.error'), color: 'var(--accent-rose)' };
      case 'closed':
        return { icon: <XCircle size={12} />, text: t('terminal.status.disconnected'), color: 'var(--text-muted)' };
      default:
        return { icon: null, text: '', color: '' };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Terminal title bar - hidden in standalone mode since Window title shows server name */}
      {isStandalone && (
        <div className="h-10 flex items-center px-3 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPatchModalOpen(false);
                setPatchModalDiff('');
                setPatchModalAutoApplied(false);
                setLastPatchBackup(null);
                onClose?.();
              }}
              className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center group"
              aria-label="Close"
            >
              <X size={8} className="opacity-0 group-hover:opacity-100 text-[#4d0000] transition-opacity" />
            </button>
            <button
              type="button"
              className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24]/30 flex items-center justify-center group"
              aria-label="Minimize"
            >
              <Minus size={8} className="opacity-0 group-hover:opacity-100 text-[#4d2d00] transition-opacity" />
            </button>
            <button
              type="button"
              className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1fa530]/30 flex items-center justify-center group"
              aria-label="Maximize"
            >
              <Maximize2 size={8} className="opacity-0 group-hover:opacity-100 text-[#003300] transition-opacity" />
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center select-none">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
              <div className="w-2 h-2 rounded-full" style={{ background: color || '#6366f1' }} />
              <span className="truncate max-w-[55vw]">{connectionName}</span>
              <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[35vw]">— {host}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs" style={{ color: statusInfo.color }}>
            {statusInfo.icon}
            <span>{statusInfo.text}</span>
          </div>
        </div>
      )}

      {/* Terminal body */}
      <div className="flex-1 relative bg-transparent min-h-0 overflow-hidden group/term">
        {/* Floating Latency Badge (Visible in all modes) */}
        {latency !== null && status === 'connected' && (
          <div 
            className="absolute top-3 right-5 z-20 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 shadow-lg opacity-80 group-hover/term:opacity-100 transition-all pointer-events-none"
            style={{ 
              color: latency < 150 ? '#4ade80' : latency < 300 ? '#fbbf24' : '#f43f5e' 
            }}
          >
            <Wifi size={10} strokeWidth={3} />
            <span className="font-mono tracking-tighter">{latency}ms</span>
          </div>
        )}

        <div
          className="h-full w-full p-1" // Padding moved here to avoid breaking FitAddon
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const sshFileData = e.dataTransfer.getData('application/ssh-file');
            if (sshFileData && termInstanceRef.current) {
              try {
                const data = JSON.parse(sshFileData);
                if (data.filePath) {
                  termInstanceRef.current.write(data.filePath);
                }
              } catch (err) {
                console.error('Drop data parse error:', err);
              }
              return;
            }

            // Fallback for standard files
            const files = e.dataTransfer.files;
            if (files.length > 0 && termInstanceRef.current) {
              const fileNames = Array.from(files).map(f => `'${f.name}'`).join(' ');
              termInstanceRef.current.write(fileNames + ' ');
            }
          }}
        >
          <div 
            ref={terminalRef} 
            className={`h-full w-full terminal-container ${osState?.terminalSettings?.activePreset === 'retro' ? 'pip-boy-terminal' : ''}`} 
            style={{ fontFamily: osState?.terminalSettings?.activePreset === 'retro' ? 'VT323, monospace' : 'inherit' }}
          />
        </div>

        {/* AI Processing Overlay removed per user request */}

        {showReconnect && (
          <div className="absolute top-3 left-5 z-50 flex items-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={handleReconnect}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20 border border-blue-500/40 transition-colors"
              title={t('common.reconnect')}
            >
              <RefreshCw size={14} />
              <span>{t('common.reconnect')}</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (!isLoggedIn) {
              setAiOpen(true);
              setAiHasOpenedOnce(true);
              setAiError('Login required to use AI helper.');
              setAiAnswer(null);
              return;
            }
            setAiOpen(v => !v);
            setAiHasOpenedOnce(true);
            setAiError(null);
            setAiAnswer(null);
          }}
          className={`absolute bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)]/80 hover:bg-[var(--bg-secondary)] border border-[var(--border-color)]/60 backdrop-blur-xl shadow-lg text-xs font-semibold transition-all ${!aiHasOpenedOnce ? 'ring-2 ring-[var(--accent-indigo)]/30 shadow-[var(--glow-indigo)]' : ''}`}
          style={{ color: 'var(--text-primary)' }}
          title={isLoggedIn ? 'AI Command Helper' : 'Login required'}
        >
          {!aiHasOpenedOnce && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
            </span>
          )}
          {isLoggedIn ? (
            <Sparkles size={14} className="text-[var(--accent-indigo)]" />
          ) : (
            <ShieldAlert size={14} className="text-[var(--accent-amber)]" />
          )}
          AI
        </button>

        {aiOpen && createPortal(
          <Rnd
            size={aiPanelSize}
            position={aiPanelPos}
            onDragStop={(e, d) => setAiPanelPos({ x: d.x, y: d.y })}
            onResizeStop={(e, dir, ref, delta, pos) => {
              setAiPanelSize({ width: ref.offsetWidth, height: ref.offsetHeight });
              setAiPanelPos(pos);
            }}
            minWidth={320}
            minHeight={280}
            dragHandleClassName="ai-panel-drag-handle"
            cancel="button,input,textarea,select,option,label"
            style={{ position: 'fixed', zIndex: 9999 }}
          >
            <div className={`w-full h-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/95 backdrop-blur-2xl shadow-2xl overflow-hidden flex flex-col relative transition-all duration-700 ${aiLoading || autoRunningRef.current ? 'ai-glow-thinking' : aiDone ? 'ai-glow-accomplished' : ''}`}>
              {/* Header */}
              <div className="ai-panel-drag-handle flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30 dark:bg-black/20">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles size={14} className="text-[var(--accent-indigo)] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t('ai.title')}</span>
                      {autoMode && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--glow-emerald)] text-[var(--accent-emerald)] animate-pulse">{t('ai.running')}</span>
                      )}
                    </div>
                    {(connectionName || host) && (
                      <span className="text-[10px] font-mono truncate max-w-[180px]" style={{ color: 'var(--accent-indigo)', opacity: 0.75 }}>
                        {connectionName || host}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setAiHistoryOpen(v => !v)} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.history')} style={{ color: 'var(--text-secondary)' }}><Clock size={12} /></button>
                  <button type="button" onClick={() => setAiSettingsOpen(v => !v)} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.settings')} style={{ color: 'var(--text-secondary)' }}><Settings2 size={12} /></button>
                  <button 
                    type="button" 
                    onClick={() => setAutoTranslate(v => !v)} 
                    className={`p-1.5 rounded transition ${autoTranslate ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5 text-[var(--text-secondary)] hover:text-indigo-400'}`} 
                    title={t('wiki.autoTranslate')}
                  >
                    <Languages size={12} />
                  </button>
                  <button type="button" onClick={() => { setAiOpen(false); setAiSettingsOpen(false); setAiHistoryOpen(false); }} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.close')} style={{ color: 'var(--text-secondary)' }}><X size={12} /></button>
                </div>
              </div>

              {/* Popovers */}
              {aiHistoryOpen && (
                <div className="absolute top-10 left-2 right-2 z-50 rounded-xl border border-white/10 bg-[var(--bg-secondary)] shadow-xl overflow-hidden">
                  <div className="p-3 border-b border-white/10 flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">{t('ai.history')}</h4>
                    <button onClick={() => setAiHistoryOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{t('ai.close')}</button>
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar">
                    {sshAiHistory.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] opacity-60" style={{ color: 'var(--text-muted)' }}>{t('ai.noHistory')}</div>
                    ) : (
                      sshAiHistory.slice(0, 20).map((h) => {
                        const isAuto = h?.type === 'auto';
                        const isExpanded = expandedHistoryId === (h.id || h.createdAt);
                        return (
                          <div key={h.id || h.createdAt} className="border-b border-white/5 last:border-0">
                            <button
                              onClick={() => {
                                if (isAuto) {
                                  setExpandedHistoryId(isExpanded ? null : (h.id || h.createdAt));
                                } else {
                                  setAiPrompt(h.prompt || '');
                                  setAiAnswer({ command: h.command || '', explain: h.explain || '', danger: !!h.danger, warn: h.warn || '', raw: '' });
                                  setAiError(null);
                                  setExecuteConfirmOpen(false);
                                  setAiHistoryOpen(false);
                                }
                              }}
                              className="w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 flex items-start gap-2"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              <span className={`mt-0.5 shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${
                                isAuto ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'
                              }`}>{isAuto ? 'AUTO' : 'ASK'}</span>
                              <div className="flex-1 min-w-0">
                                <div className="font-mono truncate opacity-80">{h.prompt}</div>
                                {!isAuto && h.command && (
                                  <div className="font-mono truncate opacity-50 text-[10px] mt-0.5">{h.command}</div>
                                )}
                                {isAuto && h.steps && (
                                  <div className="text-[9px] opacity-40 mt-0.5">{h.steps.length} steps · {h.done ? '✅ Done' : '⚠ Stopped'}</div>
                                )}
                              </div>
                              {isAuto && (
                                <span className="text-[10px] opacity-40 ml-1 shrink-0">{isExpanded ? '▲' : '▼'}</span>
                              )}
                            </button>
                            {isAuto && isExpanded && h.steps && (
                              <div className="px-3 pb-2 space-y-1 bg-black/20">
                                {h.steps.map((step, si) => (
                                  <div key={si} className="flex items-start gap-2 py-1 border-b border-white/5 last:border-0">
                                    <span className="text-[9px] font-bold text-[var(--text-muted)] mt-0.5 shrink-0 w-4">{si + 1}.</span>
                                    <div className="min-w-0">
                                      <div
                                        className="font-mono text-[10px] text-[var(--accent-indigo)] truncate cursor-pointer hover:whitespace-normal"
                                        onClick={() => {
                                          setAiPrompt(step.command);
                                          setAiHistoryOpen(false);
                                        }}
                                        title={step.command}
                                      >{step.command}</div>
                                      {step.explain && (
                                        <div className="text-[9px] opacity-60 mt-0.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>{step.explain}</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {aiSettingsOpen && (
                <div className="absolute top-10 left-0 right-0 bottom-0 z-50 rounded-b-2xl border-t border-white/10 bg-[var(--bg-secondary)] shadow-xl flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('ai.settings')}</span>
                    <button onClick={() => setAiSettingsOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{t('ai.close')}</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>{t('ai.preferSudo')}</span>
                      <input type="checkbox" checked={!!sshAiPrefs.preferSudo} onChange={(e) => setSshAiPrefs({ preferSudo: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title={t('ai.enforcePatchDesc')}>
                      <span className="flex items-center gap-1.5">
                        <span className="text-emerald-400">🧩</span>
                        {t('ai.enforcePatch')}
                      </span>
                      <input type="checkbox" checked={sshAiPrefs?.enforcePatch !== false} onChange={(e) => setSshAiPrefs({ enforcePatch: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title={t('ai.autoApplyPatchDesc')}>
                      <span className="flex items-center gap-1.5">
                        <span className="text-indigo-400">⚡</span>
                        {t('ai.autoApplyPatch')}
                      </span>
                      <input type="checkbox" checked={!!sshAiPrefs?.autoApplyPatch} onChange={(e) => setSshAiPrefs({ autoApplyPatch: e.target.checked })} disabled={!isLoggedIn || sshAiPrefs?.enforcePatch === false || sshAiPrefs?.aiTask === 'code'} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title={t('ai.backgroundTasksDesc')}>
                      <span className="flex items-center gap-1.5">
                        <span className="text-blue-400">🔄</span>
                        {t('ai.backgroundTasks')}
                      </span>
                      <input type="checkbox" checked={!!sshAiPrefs?.autoTmux} onChange={(e) => setSshAiPrefs({ autoTmux: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title={t('ai.confirmSensitiveDesc')}>
                      <span className="flex items-center gap-1.5">
                        <ShieldAlert size={12} className="text-amber-400" />
                        {t('ai.confirmSensitiveOps')}
                      </span>
                      <input type="checkbox" checked={sshAiPrefs?.confirmSensitive !== false} onChange={(e) => setSshAiPrefs({ confirmSensitive: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    {/* AI Task Mode */}
                    <div className="pt-1 space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest opacity-50" style={{ color: 'var(--text-muted)' }}>{t('ai.aiTaskMode')}</span>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => setSshAiPrefs({ aiTask: 'ssh' })}
                          disabled={!isLoggedIn}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${(!sshAiPrefs.aiTask || sshAiPrefs.aiTask === 'ssh') ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'bg-black/20 border-white/10 text-[var(--text-muted)]'}`}
                          title={t('ai.sshCommandsTitle')}
                        >
                          {t('ai.sshCommands')}
                        </button>
                        <button
                          onClick={() => setSshAiPrefs({ aiTask: 'code' })}
                          disabled={!isLoggedIn}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${sshAiPrefs.aiTask === 'code' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-black/20 border-white/10 text-[var(--text-muted)]'}`}
                          title={t('ai.codeEditorTitle')}
                        >
                          {t('ai.codeEditor')}
                        </button>
                      </div>
                      <p className="text-[9px] leading-tight opacity-50" style={{ color: 'var(--text-muted)' }}>
                        {(!sshAiPrefs.aiTask || sshAiPrefs.aiTask === 'ssh')
                          ? t('ai.sshCommandsDesc')
                          : t('ai.codeEditorDesc')}
                      </p>
                    </div>

                    <div className="pt-1">
                        <select value={sshAiPrefs.aiModel || 'auto'} onChange={(e) => setSshAiPrefs({ aiModel: e.target.value })} disabled={!isLoggedIn} className="w-full text-[11px] rounded bg-black/30 border border-white/10 px-2 py-1.5 outline-none focus:border-indigo-500/50" title={t('ai.aiModel')} style={{ color: 'var(--text-primary)' }}>
                          <option value="auto">{t('ai.autoSelect')}</option>
                          <option value="llama-3.1-8b-instant">🥉 Llama 3.1 8B (Thinking)</option>
                          <option value="meta-llama/llama-4-scout-17b-16e-instruct">🥇 Llama 4 Scout (Primary)</option>
                          <option value="llama-3.3-70b-versatile">🥈 Llama 3.3 70B (Heavy/Large)</option>
                          <option value="manual">{t('ai.customManual')}</option>
                        </select>
                    </div>
                    {sshAiPrefs.aiModel === 'manual' && (
                      <div className="space-y-2 pt-2 border-t border-white/10">
                        <div className="flex gap-2 mb-2">
                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', aiCustomModel: 'anthropic/claude-3.5-sonnet' })} className="text-[9px] px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors" title={t('ai.presets.openRouter')}>
                             🌐 OpenRouter
                           </button>
                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://api.openai.com/v1/chat/completions', aiCustomModel: 'gpt-4o' })} className="text-[9px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors" title={t('ai.presets.openAI')}>
                             🟢 OpenAI
                           </button>
                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'http://localhost:11434/v1/chat/completions', aiCustomModel: 'llama3.2' })} className="text-[9px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 transition-colors" title={t('ai.presets.ollama')}>
                             🦙 Ollama
                           </button>
                        </div>
                        <input type="text" placeholder={t('ai.endpointUrl')} value={sshAiPrefs.aiEndpoint || ''} onChange={e => setSshAiPrefs({ aiEndpoint: e.target.value })} disabled={!isLoggedIn} className="w-full text-[10px] rounded bg-black/30 border border-white/10 px-2 py-1.5 focus:border-indigo-500/50 outline-none" style={{ color: 'var(--text-primary)' }} title={t('ai.tooltips.endpoint')} />
                        <input type="password" placeholder={t('ai.apiKey')} value={sshAiPrefs.aiApiKey || ''} onChange={e => setSshAiPrefs({ aiApiKey: e.target.value })} disabled={!isLoggedIn} className="w-full text-[10px] rounded bg-black/30 border border-white/10 px-2 py-1.5 focus:border-indigo-500/50 outline-none" style={{ color: 'var(--text-primary)' }} title={t('ai.tooltips.apiKey')} />
                        <input type="text" placeholder={t('ai.modelName')} value={sshAiPrefs.aiCustomModel || ''} onChange={e => setSshAiPrefs({ aiCustomModel: e.target.value })} disabled={!isLoggedIn} className="w-full text-[10px] rounded bg-black/30 border border-white/10 px-2 py-1.5 focus:border-indigo-500/50 outline-none" style={{ color: 'var(--text-primary)' }} title={t('ai.tooltips.model')} />
                      </div>
                    )}
                  </div>
                  {/* Save button pinned at bottom, always visible */}
                  <div className="shrink-0 p-3 border-t border-white/10">
                    <button
                      onClick={() => setAiSettingsOpen(false)}
                      disabled={!isLoggedIn}
                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 disabled:text-white/30 text-white text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
                    >
                      💾 Save Settings
                    </button>
                  </div>
                </div>
              )}


              {/* Floating Mode Toggle */}
              <div className="px-4 py-2 border-b border-white/5 bg-[var(--bg-secondary)]/50 backdrop-blur-xl">
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 dark:bg-black/20 p-2 flex items-center justify-between gap-3 flex-wrap">
                  <div className="inline-flex rounded-lg bg-[var(--bg-tertiary)]/50 dark:bg-black/20 p-1 border border-white/5">
                    <button
                      type="button"
                      onClick={() => { setAiMode('manual'); setAutoMode(false); }}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${aiMode === 'manual' ? 'bg-[var(--bg-primary)] dark:bg-white/10 shadow-sm text-indigo-400' : 'hover:bg-[var(--bg-primary)]/50 dark:hover:bg-white/5 text-[var(--text-muted)]'}`}
                    >
                      {t('ai.manual')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiMode('auto')}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${aiMode === 'auto' ? 'bg-[var(--bg-primary)] dark:bg-white/10 shadow-sm text-emerald-400' : 'hover:bg-[var(--bg-primary)]/50 dark:hover:bg-white/5 text-[var(--text-muted)]'}`}
                    >
                      {t('ai.auto')}
                    </button>
                  </div>
                  
                  <div className="flex flex-1 justify-end items-center gap-2">
                    {/* Server Memory Badge */}
                    {sshMemory && (sshMemory.os || sshMemory.installedTools?.length > 0) && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20">
                        <Sparkles size={10} className="text-indigo-400" />
                        <span className="uppercase tracking-wider">{t('ai.brainSynced')}</span>
                      </div>
                    )}

                     {/* Engine Active Badge — only show in Manual to avoid clutter in Auto (where title/glow are enough) */}
                     {aiMode === 'manual' && autoMode && (
                       <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                         <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">{t('ai.engineActive')}</span>
                       </div>
                     )}
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <div ref={aiPanelContentRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-10 space-y-4">
                {/* Server Reminders / Tips — Managed only in Manual Mode to keep Auto Mode focused */}
                {aiMode === 'manual' && sshMemory?.reminders?.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <Brain size={12} className="text-purple-400" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400/80">Server Reminders</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 border-b border-purple-500/10 pb-4 mb-4">
                      {sshMemory.reminders.map((rem, idx) => (
                        <div key={idx} className="group relative rounded-xl border border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 p-3 transition-all duration-300 shadow-sm hover:shadow-purple-500/5">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] font-bold text-purple-300 truncate">{rem.title}</span>
                              {rem.category && (
                                <span className="px-1.5 py-0.5 rounded-[4px] bg-purple-500/20 text-purple-400 text-[8px] font-bold uppercase tracking-tighter">
                                  {rem.category}
                                </span>
                              )}
                            </div>
                            <button 
                              onClick={() => handleInsertCommand(rem.command)}
                              className="shrink-0 p-1.5 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-600/30 hover:text-purple-300 transition-all opacity-0 group-hover:opacity-100"
                              title={t('ai.insertCommand')}
                            >
                              <CornerDownLeft size={10} />
                            </button>
                          </div>
                          <pre className="text-[9px] font-mono text-purple-200/50 bg-black/20 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all border border-purple-500/10">
                            {rem.command}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat History - Chat-like conversation */}
                {chatHistory.length > 0 && (
                  <div className="space-y-3">
                    {chatHistory.map((msg, idx) => (
                      <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {/* User Message */}
                        {msg.role === 'user' && (
                          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600/90 dark:bg-indigo-600/80 px-4 py-2.5 text-[12px] leading-relaxed text-white shadow-lg shadow-indigo-500/10">
                            <div className="flex items-center gap-1.5 mb-1 opacity-70">
                              <span className="text-[9px] font-bold uppercase tracking-wider">You</span>
                              <span className="text-[9px] opacity-50">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            {msg.content}
                          </div>
                        )}
                        
                        {/* AI Message — only show in Manual Mode to avoid redundancy with the Roadmap/Plan in Auto Mode */}
                        {msg.role === 'assistant' && aiMode === 'manual' && (
                          <div className={`max-w-[90%] rounded-2xl rounded-tl-sm px-4 py-3 text-[12px] leading-relaxed shadow-lg ${
                            msg.danger ? 'bg-red-500/10 border border-red-500/20 text-red-100' : 
                            msg.done ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-100' : 
                            'bg-[var(--bg-tertiary)]/60 border border-white/5 text-[var(--text-primary)]'
                          }`}>
                            <div className="flex items-center gap-1.5 mb-2">
                              <Sparkles size={12} className={msg.danger ? 'text-red-400' : msg.done ? 'text-emerald-400' : 'text-[var(--accent-indigo)]'} />
                              <span className={`text-[9px] font-bold uppercase tracking-wider ${msg.danger ? 'text-red-400' : msg.done ? 'text-emerald-400' : 'text-[var(--accent-indigo)]'}`}>
                                AI Assistant
                              </span>
                              <span className="text-[9px] opacity-40 text-[var(--text-muted)]">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            
                            {/* Message Content */}
                            <div className="space-y-2">
                              {msg.content && (
                                <div className="text-[12px] leading-relaxed">
                                  {autoTranslate && aiTranslations.explain && msg.content === parsed?.explain ? aiTranslations.explain : msg.content}
                                </div>
                              )}
                              
                              {msg.warn && (
                                <div className="flex gap-2 items-start text-amber-400 text-[11px]">
                                  <span>⚠️</span>
                                  <span>{msg.warn}</span>
                                </div>
                              )}
                              
                              {msg.thought && (
                                <div className="text-[10px] italic opacity-60 border-l-2 border-white/10 pl-2">
                                  💭 {msg.thought}
                                </div>
                              )}
                              
                              {msg.plan && (
                                <div className="text-[11px] space-y-2 bg-black/20 rounded-lg p-3 border border-white/5">
                                  <div className="font-bold text-indigo-400 mb-2 flex items-center gap-1.5">
                                    <ListChecks size={12} />
                                    Task Checklist
                                  </div>
                                  {msg.plan.split('\n').filter(l => l.trim()).map((line, i) => {
                                    const stepNum = i + 1;
                                    const isDone = msg.step > stepNum || msg.done;
                                    const isCurrent = stepNum === msg.step && !msg.done;
                                    return (
                                      <div key={i} className="flex items-start gap-2.5 transition-all duration-300">
                                        <span className={`mt-0.5 shrink-0 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold transition-all ${
                                          isDone 
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                            : isCurrent
                                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                                              : 'bg-white/5 text-white/30 border border-white/10'
                                        }`}>
                                          {isDone ? '✓' : isCurrent ? '⋯' : stepNum}
                                        </span>
                                        <span className={`flex-1 transition-all ${
                                          isDone 
                                            ? 'text-emerald-400 line-through decoration-emerald-500/30' 
                                            : isCurrent
                                              ? 'text-amber-300 font-medium'
                                              : 'text-white/50'
                                        }`}>
                                          {line.replace(/^[\d\.\s\)\-]{1,5}/, '').trim()}
                                          {isCurrent && <span className="ml-2 inline-block text-[8px] text-amber-400/70">(running...)</span>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {msg.command && (
                                <div className="mt-2 rounded-lg bg-black/40 border border-white/10 overflow-hidden">
                                  <div className="px-2 py-1 text-[8px] font-mono text-white/40 uppercase tracking-wider bg-black/20">💻 Command</div>
                                  <pre className="text-[10px] font-mono p-2 text-white/90">{msg.command}</pre>
                                </div>
                              )}
                              
                              {/* Action Buttons for AI messages with commands */}
                              {msg.command && (
                                <div className="flex items-center gap-1 pt-2 mt-2 border-t border-white/5">
                                  <button onClick={() => navigator.clipboard.writeText(msg.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 hover:bg-white/10 text-[10px] transition">
                                    <Copy size={10} /> Copy
                                  </button>
                                  <button onClick={() => handleInsertCommand(msg.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-[10px] transition">
                                    <CornerDownLeft size={10} /> Insert
                                  </button>
                                  <button onClick={() => {
                                    if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                                    if (msg.danger) { setExecuteConfirmOpen(true); setAiAnswer({ ...msg, danger: true }); return; }
                                    handleExecuteCommand(msg.command);
                                  }} disabled={!isLoggedIn} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[10px] transition ${msg.danger ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400' : 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400'}`}>
                                    <CornerDownLeft size={10} /> Run
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Patch Review Modal */}
                {patchModalOpen && (
                  (typeof document !== 'undefined'
                    ? createPortal(
                        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => {
                          if (e.target === e.currentTarget) {
                            setPatchModalOpen(false);
                          }
                        }}>
                          <Rnd
                            default={{ x: 0, y: 0, width: 920, height: 520 }}
                            enableResizing={true}
                            minWidth={520}
                            minHeight={320}
                            dragHandleClassName="patch-modal-drag-handle"
                            cancel="button,input,textarea,select,option,label,pre"
                            className="z-[10000]"
                            style={{ position: 'relative' }}
                          >
                            <div className="w-full h-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl overflow-hidden flex flex-col">
                              <div className="patch-modal-drag-handle flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] cursor-move">
                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Patch Review</div>
                                  {patchModalAutoApplied && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">Auto-applied</span>
                                  )}
                                </div>
                                <button onClick={() => setPatchModalOpen(false)} className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }} title={t('ai.cancel')}>
                                  <X size={14} />
                                </button>
                              </div>

                              <div className="p-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                                  {lastPatchResultData ? (
                                    renderDmpDiffByResult(
                                      lastPatchResultData,
                                      patchFileCollapsed,
                                      setPatchFileCollapsed,
                                      lastPatchBackup,
                                      (filePath, backupId) => {
                                        if (!isLoggedIn) { setAiError('Login required'); return; }
                                        const safeFile = `'${String(filePath).replace(/'/g, "'\\''")} '`;
                                        const cmd = `if [ -f ${safeFile}.bak.${backupId} ]; then mv ${safeFile}.bak.${backupId} ${safeFile}; echo "✅ Rolled back ${filePath}"; else echo "⚠️ No backup found for ${filePath}"; fi`;
                                        handleExecuteCommand(cmd, true);
                                      }
                                    )
                                  ) : (
                                    renderDiffByFile(
                                      patchModalDiff,
                                      patchFileCollapsed,
                                      setPatchFileCollapsed,
                                      lastPatchBackup,
                                      (filePath, backupId) => {
                                        if (!isLoggedIn) { setAiError('Login required'); return; }
                                        const safeFile = `'${String(filePath).replace(/'/g, "'\\''")} '`;
                                        const cmd = `if [ -f ${safeFile}.bak.${backupId} ]; then mv ${safeFile}.bak.${backupId} ${safeFile}; echo "✅ Rolled back ${filePath}"; else echo "⚠️ No backup found for ${filePath}"; fi`;
                                        handleExecuteCommand(cmd, true);
                                      }
                                    )
                                  )}
                              </div>

                              <div className="flex gap-2 px-4 py-3 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/70">
                                <button onClick={() => setPatchModalOpen(false)} className="flex-1 py-2 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {t('ai.cancel')}
                                </button>
                                {/* Rollback All — only shown when backup exists */}
                                {lastPatchBackup?.id && (
                                  <button onClick={() => {
                                    const rb = buildPatchRollbackCommand(lastPatchBackup);
                                    if (!rb) { setAiError('No rollback available'); return; }
                                    setPatchModalOpen(false);
                                    handleExecuteCommand(rb, true);
                                    setLastPatchBackup(null);
                                    setLastPatchResultData(null);
                                    setPatchModalAutoApplied(false);
                                  }} disabled={!isLoggedIn} className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-red-600/70 hover:bg-red-600 text-white text-xs transition border border-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
                                    ↩ Rollback All
                                  </button>
                                )}
                                <button onClick={() => navigator.clipboard.writeText(patchModalDiff || '')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-xs transition border border-[var(--border-color)]" style={{ color: 'var(--text-primary)' }}>
                                  <Copy size={12} /> {t('ai.copy')}
                                </button>
                                {!patchModalAutoApplied ? (
                                  <button onClick={async () => {
                                    if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                                    const backupId = `${Date.now().toString(36)}`;
                                    setPatchModalOpen(false);
                                    const result = await applyPatchViaSftp(patchModalDiff, backupId);
                                    const files = result.files || [];
                                    setLastPatchBackup({ id: backupId, files });
                                    setLastPatchResultData(result.results || null);
                                    if (!result.success) {
                                      setAiError(`Patch failed: ${result.error || result.summary || 'Unknown error'}`);
                                    }
                                    setPatchModalAutoApplied(true);
                                  }} disabled={!isLoggedIn} className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-emerald-600/80 dark:bg-emerald-600/50 hover:bg-emerald-500 text-white text-xs transition border border-emerald-500/20">
                                    <CornerDownLeft size={12} /> Apply Patch
                                  </button>
                                ) : (
                                  <button disabled className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-emerald-600/20 text-emerald-200 text-xs transition border border-emerald-500/10 opacity-60 cursor-not-allowed">
                                    Applied
                                  </button>
                                )}
                              </div>
                            </div>
                          </Rnd>
                        </div>,
                        document.body
                      )
                    : null)
                )}

                {/* File Changes (diff) - Collapsible */}
                {sshAiPrefs?.aiTask === 'code' && fileChanges?.diffText && (
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 dark:bg-black/20 overflow-hidden">
                    <div
                      className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setFileChangesCollapsed(!fileChangesCollapsed)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>File Changes</span>
                        <span className="text-[9px] opacity-60 font-mono" style={{ color: 'var(--text-secondary)' }}>
                          +{fileChanges.added} / -{fileChanges.removed}
                        </span>
                        {Array.isArray(fileChanges.files) && fileChanges.files.length > 0 && (
                          <span className="text-[9px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {fileChanges.files.length} file(s)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(fileChanges.diffText || ''); }}
                          className="p-1 rounded hover:bg-white/5"
                          title={t('ai.copy')}
                        >
                          <Copy size={10} />
                        </button>
                        <button className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                          {fileChangesCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                      </div>
                    </div>
                    {!fileChangesCollapsed && (
                      <div className="p-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex gap-3">
                          <div className="w-[160px] shrink-0 space-y-1">
                            {Array.isArray(fileChanges.files) && fileChanges.files.map((f) => (
                              <button
                                key={f.path}
                                onClick={() => setSelectedDiffFile(f.path)}
                                className={`w-full text-left rounded px-2 py-1 border transition ${selectedDiffFile === f.path ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-black/10 border-white/5 hover:bg-white/5'}`}
                              >
                                <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-primary)' }}>{f.path}</div>
                                <div className="text-[9px] font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                  <span className="text-emerald-400">+{f.added || 0}</span>
                                  <span className="mx-1 opacity-40">/</span>
                                  <span className="text-rose-400">-{f.removed || 0}</span>
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="flex-1 min-w-0">
                            {(() => {
                              const chosen = Array.isArray(fileChanges.files)
                                ? fileChanges.files.find((x) => x.path === selectedDiffFile)
                                : null;
                              const textToShow = chosen?.lines?.length ? chosen.lines.join('\n') : fileChanges.diffText;
                              return (
                                <pre className="text-[10px] font-mono whitespace-pre-wrap break-words max-h-44 overflow-y-auto custom-scrollbar" style={{ color: 'var(--text-secondary)' }}>
                                  {textToShow}
                                </pre>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {aiStreaming && (
                  <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                        <Loader2 size={12} className="animate-spin" />
                        Streaming
                      </div>
                      <span className="text-[9px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        live
                      </span>
                    </div>
                    <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      {aiStreamText || '...'}
                    </div>
                  </div>
                )}







                {/* Main AI Response Bubble - Hidden when done to show summary instead, and hidden in Auto Mode */}
                {aiAnswer && !aiDone && aiMode === 'manual' && (
                  <div className={`rounded-lg border overflow-hidden ${aiAnswer.danger ? 'border-red-500/30' : 'border-white/10'}`}>
                    {/* Header - Always visible, clickable to collapse */}
                    <div 
                      className={`px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity ${aiAnswer.danger ? 'bg-red-500/10' : aiAnswer.done ? 'bg-emerald-500/10' : 'bg-black/20'}`}
                      onClick={() => setAiAnswerCollapsed(!aiAnswerCollapsed)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 opacity-80">
                            <Sparkles size={12} className="text-[var(--accent-indigo)]" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-indigo)]">
                              {aiAnswer.raw.includes('AUTO_FIX_REQUEST') ? t('ai.autoFix') : 'Zeroclaw AI'}
                            </span>
                          </div>
                          {aiAnswer.usedModel && (
                            <span className="text-[8px] opacity-50 font-mono tracking-tight text-[var(--text-muted)]">
                              {aiAnswer.usedModel.split('/').pop().replace(/-/g, ' ')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {aiAnswer.raw.includes('AUTO_FIX_REQUEST') && <span className="text-[9px] font-bold bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/30">{t('ai.autoFix')}</span>}
                          {aiAnswer.done && <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10} /> {t('ai.done')}</span>}
                          {aiAnswer.danger && <span className="text-[10px] font-bold text-red-400 flex items-center gap-1"><ShieldAlert size={10} /> {t('ai.danger')}</span>}
                          {aiAnswer.interactive && <span className="text-[10px] font-bold text-amber-400">⚡ {aiAnswer.interactive}</span>}
                          <button className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                            {aiAnswerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Content - Collapsible */}
                    {!aiAnswerCollapsed && (
                      <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="px-3 py-2">
                      {/* Conversational Explanation & Thoughts (Always visible for transparency) */}
                      {(aiAnswer.explain || aiAnswer.warn || aiAnswer.thought) && (
                        <div className="mb-3 border-b border-white/5 pb-2">
                           {aiAnswer.warn && (
                             <div className="text-red-500 font-medium mb-1.5 flex gap-1.5 items-start">
                               <AlertCircle size={14} className="mt-0.5 shrink-0" />
                               <span>{autoTranslate && aiTranslations.warn ? aiTranslations.warn : (translatingAiText.warn ? '...' : aiAnswer.warn)}</span>
                             </div>
                           )}
                           {aiAnswer.explain && aiAnswer.explain.trim().length > 0 && (
                             <div className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                               {autoTranslate && aiTranslations.explain ? aiTranslations.explain : (translatingAiText.explain ? '...' : aiAnswer.explain)}
                             </div>
                           )}
                           {aiAnswer.thought && aiAnswer.thought.trim().length > 0 && (
                             <div className="p-2.5 rounded-lg border border-black/20 bg-black/20 overflow-hidden opacity-70 hover:opacity-100 transition-opacity">
                               <div className="text-[10px] font-medium leading-relaxed italic text-[var(--text-muted)]">
                                 "{autoTranslate && aiTranslations.thought ? aiTranslations.thought : (translatingAiText.thought ? '...' : aiAnswer.thought)}"
                               </div>
                             </div>
                           )}
                        </div>
                      )}

                      {/* Proposed Patch (VSCode-like) */}
                      {aiAnswer.diff && (
                        <div className="mt-2 rounded bg-black/40 border border-white/5 overflow-hidden">
                          <div className="px-2 py-1 text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider bg-black/40 border-b border-white/5">Proposed Patch</div>
                          <div className="flex items-center gap-1 p-2 border-t border-white/5 bg-black/20">
                            <button onClick={() => {
                              setPatchModalDiff(aiAnswer.diff || '');
                              setPatchModalOpen(true);
                            }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-indigo-600/80 dark:bg-indigo-600/50 hover:bg-indigo-500 text-white text-xs transition border border-indigo-500/20">
                              Review Patch
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(aiAnswer.diff || '')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-xs transition border border-[var(--border-color)]" style={{ color: 'var(--text-primary)' }}><Copy size={12} /> {t('ai.copy')}</button>
                          </div>
                        </div>
                      )}

                      {aiAnswer.command && (
                        <div className="mt-2 rounded bg-black/40 border border-white/5 overflow-hidden">
                          <div className="px-2 py-1 text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider bg-black/40 border-b border-white/5">Terminal Command</div>
                          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words px-2.5 py-2" style={{ color: 'var(--text-primary)' }}>
                            {aiAnswer.command}
                          </pre>
                        </div>
                      )}
                    </div>
                    {aiAnswer.command && (
                      <div className="flex items-center gap-1 p-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/50">
                        <button onClick={() => navigator.clipboard.writeText(aiAnswer.command || '')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-xs transition border border-[var(--border-color)]" style={{ color: 'var(--text-primary)' }}><Copy size={12} /> {t('ai.copy')}</button>
                        <button onClick={() => handleInsertCommand(aiAnswer.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-600/80 dark:bg-emerald-600/50 hover:bg-emerald-500 text-white text-xs transition border border-emerald-500/20"><CornerDownLeft size={12} /> {t('ai.insert')}</button>
                        <button onClick={() => {
                          if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                          if (aiAnswer.danger) { setExecuteConfirmOpen(true); return; }
                          handleExecuteCommand(aiAnswer.command);
                        }} disabled={!isLoggedIn || (executeConfirmOpen && aiAnswer.danger)} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-white text-xs transition ${aiAnswer.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'} ${(executeConfirmOpen && aiAnswer.danger) ? 'opacity-70 cursor-not-allowed' : ''}`}>
                          {executeConfirmOpen && aiAnswer.danger ? t('ai.confirmRun') : <><CornerDownLeft size={12} /> {t('ai.run')}</>}
                        </button>
                      </div>
                    )}
                      </div>
                    )}
                  </div>
                )}

                {/* Injected Skills Panel — shows which skills were loaded */}
                {injectedSkills && !skillsSearchLoading && (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 overflow-hidden mb-3 animate-in fade-in zoom-in-95 duration-300 shadow-lg shadow-emerald-500/10">
                    {/* Header */}
                    <div className="px-3 py-2.5 bg-emerald-600/25 border-b border-emerald-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                        <CheckCircle2 size={12} className="text-emerald-400" />
                        Skills Ready — AI Context Updated
                      </div>
                      <button onClick={() => setInjectedSkills(null)} className="text-emerald-300/60 hover:text-emerald-300"><X size={12} /></button>
                    </div>
                    {/* CTA banner */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/15 border-b border-emerald-500/20">
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400 shrink-0"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
                      <span className="text-[9px] text-emerald-300 font-bold tracking-wide">Skills injected — click <span className="text-emerald-200 underline decoration-dotted">Resume Engine</span> to start with enhanced knowledge</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {/* All available skills */}
                      <div className="text-[9px] text-white/40 font-mono leading-relaxed">
                        <span className="text-emerald-400/70 font-bold">[Skills]</span> Available: {injectedSkills.allAvailable.length > 0 ? injectedSkills.allAvailable.join(', ') : 'none'}
                      </div>
                      {/* Matched skills with staggered animation */}
                      <div className="text-[9px] text-white/40 font-mono leading-relaxed">
                        <span className="text-emerald-400/70 font-bold">[Skills]</span> Matched: {injectedSkills.skills.length > 0 ? injectedSkills.skills.map(s => s.name).join(', ') : 'none'}
                      </div>
                      {injectedSkills.skills.length > 0 && (
                        <div className="space-y-1.5 mt-2">
                          {injectedSkills.skills.map((skill, i) => (
                            <div
                              key={skill.name}
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-600/10 animate-in slide-in-from-left-3 fade-in duration-300"
                              style={{ animationDelay: `${i * 150}ms`, animationFillMode: 'both' }}
                            >
                              <div className="w-5 h-5 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                                <CheckCircle2 size={10} className="text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-bold text-emerald-300 truncate">{skill.name}</div>
                                <div className="text-[8px] text-white/40 truncate mt-0.5">
                                  {skill.description || (skill.source === 'custom' ? 'Local expert skill' : 'Installed SkillMP knowledge')}
                                </div>
                                <div className="text-[7px] text-white/20 uppercase tracking-tighter mt-0.5 font-bold">
                                  Source: {skill._source || skill.source || 'local'} • Status: Injected
                                </div>
                              </div>
                              <span className="text-[8px] text-emerald-400/50 font-bold uppercase shrink-0">Active</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {injectedSkills.skills.length === 0 && (
                        <div className="text-[9px] text-amber-400/60 mt-1">No skills matched this goal. AI will use general knowledge.</div>
                      )}
                    </div>
                  </div>
                )}

                {/* SkillsMP Loading Animation */}
                {skillsSearchLoading && (
                  <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/60 overflow-hidden mb-3 animate-in fade-in duration-200">
                    {/* Top banner — clear notice */}
                    <div className="px-3 py-2.5 bg-indigo-600/25 border-b border-indigo-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
                        <svg className="animate-spin shrink-0" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                        Injecting Skills — Please Wait
                      </div>
                      <div className="flex items-center gap-1">
                        {[0, 150, 300].map((delay, i) => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                        ))}
                      </div>
                    </div>
                    {/* Lock notice */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 shrink-0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <span className="text-[9px] text-amber-300/80 font-semibold">Resume Engine is locked until skills are ready</span>
                    </div>
                    <div className="p-4">
                      {/* Radar pulse */}
                      <div className="flex items-center justify-center py-3">
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <div className="absolute inset-0 rounded-full border-2 border-indigo-500/40 animate-ping" style={{ animationDuration: '1.2s' }} />
                          <div className="absolute inset-2 rounded-full border border-indigo-400/30 animate-ping" style={{ animationDelay: '0.3s', animationDuration: '1.2s' }} />
                          <div className="absolute inset-4 rounded-full border border-indigo-300/20 animate-ping" style={{ animationDelay: '0.6s', animationDuration: '1.2s' }} />
                          <div className="relative z-10 w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center">
                            <Brain size={14} className="text-indigo-300 animate-pulse" />
                          </div>
                        </div>
                      </div>
                      {/* Skeleton skill cards */}
                      <div className="space-y-2 mt-1">
                        {[1, 0.75, 0.5].map((opacity, i) => (
                          <div
                            key={i}
                            className="h-11 rounded-lg bg-black/20 border border-white/5 animate-pulse flex items-center px-3 gap-3"
                            style={{ animationDelay: `${i * 120}ms`, opacity }}
                          >
                            <div className="flex-1 space-y-1.5">
                              <div className="h-2 bg-indigo-500/30 rounded-full" style={{ width: `${55 + i * 12}%` }} />
                              <div className="h-1.5 bg-white/10 rounded-full" style={{ width: `${40 + i * 8}%` }} />
                            </div>
                            <div className="shrink-0 h-5 w-12 bg-indigo-600/25 rounded-lg" />
                          </div>
                        ))}
                      </div>
                      <p className="text-center text-[9px] text-indigo-300/50 mt-3 animate-pulse tracking-widest uppercase">
                        Searching & injecting skills into AI context...
                      </p>
                    </div>
                  </div>
                )}


                {bgTaskStatus?.active && (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 mb-3 shadow-lg shadow-sky-500/5 animate-in fade-in slide-in-from-right-4 duration-500">
                    <div className="flex items-center justify-between mb-2">
                       <div className="flex items-center gap-2">
                          <div className="relative h-2 w-2">
                             <span className="absolute inset-0 rounded-full bg-sky-400 animate-ping opacity-75"></span>
                             <span className="relative inline-block h-2 w-2 rounded-full bg-sky-500"></span>
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">Background Task Live</span>
                       </div>
                       <button onClick={() => setShowBgMonitor(!showBgMonitor)} className="text-[10px] text-sky-400/70 hover:text-sky-400 flex items-center gap-1 transition">
                          {showBgMonitor ? 'Hide Logs' : 'Show Logs'} {showBgMonitor ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                       </button>
                    </div>

                    {showBgMonitor && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                         <div className="rounded bg-black/40 border border-sky-500/10 p-2 font-mono text-[9px] text-sky-200/80 max-h-32 overflow-y-auto scrollbar-thin">
                            {bgTaskLogs.length > 0 ? (
                              bgTaskLogs.map((l, i) => <div key={i} className="truncate select-text"> {l}</div>)
                            ) : (
                              <div className="opacity-50 italic">Initializing background stream...</div>
                            )}
                         </div>
                         <div className="flex gap-2">
                            <button onClick={() => handleExecuteCommand('tmux attach-session -t ai-bg-task')} className="flex-1 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[10px] font-bold transition border border-sky-500/20 flex items-center justify-center gap-1.5">
                               <SquareArrowOutUpRight size={10} /> Attach Session
                            </button>
                            <button onClick={() => {
                               if (!isLoggedIn) return;
                               handleExecuteCommand('tmux kill-session -t ai-bg-task');
                               setBgTaskStatus(null);
                            }} className="px-3 py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[10px] font-bold transition border border-rose-500/20">
                               Terminate
                            </button>
                         </div>
                      </div>
                    )}
                    
                    {!showBgMonitor && bgTaskLogs.length > 0 && (
                       <div className="text-[9px] font-mono text-sky-400/60 truncate italic opacity-80 pl-4 py-0.5">
                          Latest: {bgTaskLogs[bgTaskLogs.length - 1]}
                       </div>
                    )}
                  </div>
                )}

                {/* AI Plan / Intention */}
                {aiAnswer && aiAnswer.plan && !aiAnswer.done && (
                  <div className={`relative rounded-xl border border-[var(--accent-indigo)]/20 bg-[var(--accent-indigo)]/5 p-3 space-y-2 transition-all duration-500 ${aiLoading || autoRunningRef.current ? 'opacity-80' : ''}`}>
                    {/* Premium Thinking Glow */}
                    {(aiLoading || autoRunningRef.current) && (
                      <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-indigo-500/20 animate-pulse-slow -z-10 opacity-70" />
                    )}
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-indigo)]">
                        <ListChecks size={12} />
                        {t('ai.roadmap')}
                      </div>
                      {(aiLoading || autoRunningRef.current) && (
                        <div className="flex items-center gap-1.5">
                           <span className="text-[9px] text-[var(--accent-indigo)] opacity-70 animate-pulse italic">{t('ai.thinking')}</span>
                           <Loader2 size={10} className="animate-spin text-[var(--accent-indigo)]" />
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] leading-relaxed space-y-1.5">
                      {aiAnswer.plan.split('\n').filter(l => l.trim().length > 2).map((line, i) => {
                        const stepNum = i + 1;
                        const isCurrent = stepNum === aiAnswer.step && !(aiLoading || autoRunningRef.current);
                        const isPast = stepNum < aiAnswer.step;
                        const isFuture = stepNum > aiAnswer.step;
                        
                        return (
                          <div key={i} className={`flex gap-2.5 transition-all duration-300 ${isCurrent ? 'translate-x-1' : ''}`}>
                            <span className={`tabular-nums font-bold min-w-[18px] transition-colors ${
                              isCurrent ? 'text-emerald-400' : 
                              isPast ? 'text-[var(--text-muted)] opacity-50' : 
                              'text-[var(--text-muted)] opacity-40'
                            }`}>
                              {stepNum}.
                            </span>
                            <span className={`flex-1 transition-colors ${
                              isCurrent ? 'text-emerald-300 font-bold' : 
                              isPast ? 'text-[var(--text-muted)] line-through decoration-white/10' : 
                              'text-[var(--text-secondary)] opacity-70'
                            }`}>
                               {line.replace(/^[\d\.\s\)\-]{1,5}/, '').trim()}
                               {isCurrent && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Error — shown at bottom for easy reading */}

                {/* Token Limit Hit Banner */}
                {aiLimitHit && (
                  <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">⚠️</span>
                      <div>
                        <div className="text-sm font-bold text-amber-300">{t('ai.limitReached')}</div>
                        <div className="text-[10px] text-amber-400/70 mt-0.5">{t('ai.limitDesc')}</div>
                      </div>
                    </div>
                    {aiLimitGoal && (
                      <div className="text-[10px] text-amber-300/60 font-mono truncate border border-amber-500/20 rounded px-2 py-1 bg-black/20">
                        {t('ai.goal')}: {aiLimitGoal}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => {
                          setAiLimitHit(false);
                          if (aiLimitGoal) {
                            setAutoGoal(aiLimitGoal);
                            setAiMode('auto');
                            setAutoMode(true);
                            setAutoStepsRemaining(MAX_AUTO_STEPS);
                            setLastResultAt(Date.now());
                          }
                        }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 text-white border border-emerald-500/30 transition"
                      >
                        {t('ai.continueTask')}
                      </button>
                      <button
                        onClick={() => setAiLimitHit(false)}
                        className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-white/10 hover:bg-white/5 transition"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Auto Step History - Moved to bottom nest — only show in Auto Mode to avoid cluttering Manual view */}
                {autoStepHistory.length > 0 && aiMode === 'auto' && (
                  <div className="space-y-2 border-t border-white/5 pt-4">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('ai.completedSteps')}</span>
                      <span className="text-[9px] opacity-40 italic">{t('ai.lastActions', { count: autoStepHistory.length })}</span>
                    </div>
                    <div className="space-y-1.5 overflow-y-auto max-h-[200px] pr-1 scrollbar-thin">
                      {autoStepHistory.map((step, idx) => (
                        <div key={idx} className="rounded-lg border border-white/5 bg-black/10 p-2 text-[10px] flex items-start gap-2.5 transition-all hover:border-white/10 group">
                          <div className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${idx === autoStepHistory.length - 1 && autoMode ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[10px] text-[var(--text-primary)] leading-snug">{step.explain}</div>
                            <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)] opacity-70 truncate group-hover:whitespace-normal group-hover:break-all transition-all bg-black/20 px-1.5 py-0.5 rounded border border-white/5 inline-block">{step.command}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Interactive Prompt - All Types */}
                {interactivePrompt && (!autoMode || aiMode !== 'auto') && (
                  <div className={`rounded-lg border p-3 ${
                    interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase'
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}>
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                      {interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' ? '🔒 Password Required' :
                       interactivePrompt.kind === 'passphrase' ? '🔑 Passphrase Required' :
                       interactivePrompt.kind === 'confirm_yn' || interactivePrompt.kind === 'confirm_overwrite' ? '❓ Confirmation Required' :
                       interactivePrompt.kind === 'ssh_host_verify' ? '🔗 SSH Host Verification' :
                       interactivePrompt.kind === 'press_enter' ? '⏎ Press ENTER' :
                       interactivePrompt.kind === 'selection' ? '📋 Selection Required' :
                       '⌨️ Input Required'}
                    </div>
                    <pre className="text-[10px] font-mono whitespace-pre-wrap mb-2 opacity-80" style={{ color: 'var(--text-primary)' }}>{interactivePrompt.text}</pre>
                    
                    {/* Y/N Buttons */}
                    {(interactivePrompt.kind === 'confirm_yn' || interactivePrompt.kind === 'confirm_overwrite') && (
                      <div className="flex gap-2">
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('y'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes (y)</button>
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('n'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No (n)</button>
                      </div>
                    )}

                    {/* SSH Host Verification */}
                    {interactivePrompt.kind === 'ssh_host_verify' && (
                      <div className="flex gap-2">
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('yes'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes</button>
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('no'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No</button>
                      </div>
                    )}

                    {/* Press ENTER */}
                    {interactivePrompt.kind === 'press_enter' && (
                      <button onClick={() => { setInteractivePrompt(null); if (socketRef.current?.connected) socketRef.current.emit('ssh:input', '\n'); if (aiMode === 'auto') setAutoMode(true); }} className="w-full py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Press ENTER</button>
                    )}

                    {/* Password warning (manual only) */}
                    {(interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase') && (
                      <div className="space-y-3 mt-1">
                        <div className="text-[10px] opacity-70" style={{ color: 'var(--text-secondary)' }}>
                          Type your {interactivePrompt.kind === 'sudo_password' ? 'sudo password' : interactivePrompt.kind} directly in the terminal below.
                        </div>
                        {aiMode === 'auto' && !autoMode && (
                          <button 
                            onClick={() => {
                              suppressInteractiveUntilRef.current = Date.now() + 6000; // 6s grace
                              autoModeRef.current = true; // set ref synchronously before setTimeout
                              bypassPasswordPauseRef.current = true; // skip predictive pause for next step
                              setInteractivePrompt(null);
                              setAiError(null);
                              setAutoMode(true);
                              setTimeout(() => {
                                autoRunningRef.current = false;
                                runAutoStep();
                              }, 2000); // Wait 2s for terminal to settle after password
                            }}
                            className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/20 uppercase tracking-wider"
                          >
                            Done, Resume Engine
                          </button>
                        )}
                      </div>
                    )}

                    {/* Selection / Text Input / Password */}
                    {(interactivePrompt.kind === 'selection' || interactivePrompt.kind === 'text_input' || interactivePrompt.kind === 'ssh_key_file' || interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase') && (
                      <div className="flex gap-2">
                        <input
                          id="ai-interactive-input"
                          type={interactivePrompt.kind.includes('password') || interactivePrompt.kind === 'passphrase' ? 'password' : 'text'}
                          placeholder={
                            interactivePrompt.kind === 'selection' ? 'Enter selection...' : 
                            interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' ? 'Enter password...' :
                            interactivePrompt.kind === 'passphrase' ? 'Enter passphrase...' :
                            'Enter value...'
                          }
                          autoFocus
                          className="flex-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] px-2 py-1.5 text-xs outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = e.target.value;
                              const isPassword = interactivePrompt.kind.includes('password') || interactivePrompt.kind === 'passphrase';
                              if (isPassword) suppressInteractiveUntilRef.current = Date.now() + 6000;
                              setInteractivePrompt(null);
                              sendQuickInput(val);
                          if (aiModeRef.current === 'auto') {
                                autoModeRef.current = true; // set ref synchronously
                                bypassPasswordPauseRef.current = true; // skip predictive pause for next step
                                setAutoMode(true);
                                setTimeout(() => {
                                  autoRunningRef.current = false;
                                  runAutoStep();
                                }, isPassword ? 2000 : 500);
                              }
                            }
                          }}
                        />
                        <button onClick={() => { 
                          const val = document.getElementById('ai-interactive-input')?.value || '';
                          const isPassword = interactivePrompt.kind.includes('password') || interactivePrompt.kind === 'passphrase';
                          if (isPassword) suppressInteractiveUntilRef.current = Date.now() + 6000;
                          setInteractivePrompt(null); 
                          sendQuickInput(val); 
                          if (aiModeRef.current === 'auto') {
                            autoModeRef.current = true; // set ref synchronously
                            bypassPasswordPauseRef.current = true; // skip predictive pause for next step
                            setAutoMode(true);
                            setTimeout(() => {
                              autoRunningRef.current = false;
                              runAutoStep();
                            }, isPassword ? 2000 : 500);
                          }
                        }} className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium uppercase tracking-wider">Send</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Danger Confirmation */}
                {executeConfirmOpen && aiAnswer?.danger && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-red-600 dark:text-red-300 mb-2"><ShieldAlert size={12} /> {t('ai.confirmExecution')}</div>
                    <div className="text-[11px] opacity-80 mb-3" style={{ color: 'var(--text-primary)' }}>{t('ai.confirmText')}</div>
                    <div className="flex gap-2">
                      <button onClick={() => setExecuteConfirmOpen(false)} className="flex-1 py-1.5 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t('ai.cancel')}</button>
                      <button onClick={() => {
                        setExecuteConfirmOpen(false);
                        setAiError(null);
                        setAiAnswer((prev) => (prev ? { ...prev, danger: false } : prev));
                        handleExecuteCommand(aiAnswer?.command);
                        if (aiMode === 'auto') {
                          setAutoMode(true);
                        }
                      }} disabled={!isLoggedIn} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">{t('ai.execute')}</button>
                    </div>
                  </div>
                )}

                {/* Sensitive Operation Confirmation */}
                {sensitiveConfirmOpen && pendingSensitiveCommand && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-300 mb-2">
                      <ShieldAlert size={12} /> Sensitive Operation
                    </div>
                    <div className="text-[11px] opacity-80 mb-2" style={{ color: 'var(--text-primary)' }}>
                      This command may affect system security or stability:
                    </div>
                    <div className="rounded bg-black/40 border border-amber-500/20 p-2 mb-3">
                      <code className="text-[10px] font-mono text-amber-400 break-all">{pendingSensitiveCommand}</code>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setSensitiveConfirmOpen(false);
                          setPendingSensitiveCommand(null);
                        }} 
                        className="flex-1 py-1.5 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" 
                        style={{ color: 'var(--text-primary)' }}
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => {
                          const cmd = pendingSensitiveCommand;
                          setSensitiveConfirmOpen(false);
                          setPendingSensitiveCommand(null);
                          executeCommandInternal(cmd);
                        }} 
                        disabled={!isLoggedIn} 
                        className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium"
                      >
                        Execute Anyway
                      </button>
                    </div>
                  </div>
                )}
              
                {/* Mission Accomplished Inline Summary (Antigravity Style) */}
                {aiDone && aiDoneSummary && (
                  <motion.div 
                    ref={aiDoneRef}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden animate-in fade-in zoom-in-95 duration-500"
                  >
                    <div className="relative p-4 flex flex-col items-center text-center">
                       {/* Glow Effects */}
                       <div className="absolute -top-12 -left-12 h-24 w-24 rounded-full bg-emerald-500/10 blur-[40px] pointer-events-none" />
                       
                       <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 shadow-inner">
                         <Trophy className="h-6 w-6 text-emerald-400" />
                       </div>

                       <h2 className="mb-2 text-base font-black tracking-tight text-white uppercase italic">
                         {t('ai.missionAccomplished')}
                       </h2>

                       <div className="mb-4 flex items-start gap-1.5 rounded-lg border border-emerald-500/20 bg-black/40 px-3 py-1.5 text-[9px] font-semibold text-emerald-400/80 max-w-full">
                         <Sparkles size={10} className="shrink-0 mt-0.5" />
                         <span className="break-words text-left leading-snug">{aiDoneSummary.goal}</span>
                       </div>

                       {/* Final Explanation - Only show if it provides actual info */}
                       {aiDoneSummary.explain && aiDoneSummary.explain.trim().length > 5 && (
                         <div className="w-full rounded-xl border border-white/5 bg-white/5 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300 italic mb-4 text-left">
                           "{aiDoneSummary.explain}"
                         </div>
                       )}

                       {/* Step List */}
                       {aiDoneSummary.steps && aiDoneSummary.steps.length > 0 && (
                         <div className="w-full text-left space-y-2 mb-4">
                            <div className="text-[9px] font-black uppercase tracking-widest text-emerald-400/50 mb-1 px-1">Actions Taken</div>
                            <div className="max-h-[150px] overflow-y-auto scrollbar-thin pr-1 divide-y divide-white/5 bg-black/20 rounded-lg">
                               {aiDoneSummary.steps.map((step, idx) => (
                                 <div key={idx} className="p-2 flex items-start gap-2">
                                   <div className="mt-0.5 shrink-0 h-3.5 w-3.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                                     <span className="text-[6px] font-black text-emerald-400">{idx + 1}</span>
                                   </div>
                                   <div className="min-w-0 flex-1">
                                     {step.command && step.command !== '[Wait]' && (
                                       <code className="block text-[8px] font-mono text-indigo-300/80 bg-indigo-500/5 px-1 rounded mb-0.5 truncate">{step.command}</code>
                                     )}
                                     <p className="text-[9px] text-zinc-400 leading-tight">{step.explain}</p>
                                   </div>
                                 </div>
                               ))}
                            </div>
                         </div>
                       )}

                       <button 
                         onClick={() => { setAiDone(false); setAiDoneSummary(null); }}
                         className="group relative w-full overflow-hidden rounded-xl bg-emerald-500 px-4 py-2.5 transition-all hover:scale-[1.02] active:scale-[0.98]"
                       >
                         <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-emerald-600 opacity-0 transition-opacity group-hover:opacity-100" />
                         <span className="relative flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-950">
                           {t('ai.dismissSummary')} <CornerDownLeft size={12} />
                         </span>
                       </button>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* ── Error Banner (bottom, most visible) ── */}
              {aiError && (
                <div className="mx-3 mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-[11px] flex items-start gap-2" style={{ color: 'var(--text-primary)' }}>
                  <span className="shrink-0 mt-0.5 text-red-400">⚠</span>
                  <span className="flex-1 leading-snug">{aiError}</span>
                  <button onClick={() => setAiError(null)} className="shrink-0 text-red-400/60 hover:text-red-400 transition-colors" title={t('common.dismiss')}>
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Floating Input Footer - Antigravity Style */}
              <div className="border-t border-white/5 bg-[var(--bg-secondary)] dark:bg-[#0c0c0c]/90 backdrop-blur-3xl z-40 transition-all duration-300">
                {/* Active Skills Panel — slides in above the footer */}
                {showSkillsList && activeSkills.length > 0 && (
                  <div className="border-b border-indigo-500/20 bg-indigo-950/60 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="px-3 py-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-indigo-300">
                        <Brain size={10} />
                        Skills in AI Context ({activeSkills.length})
                      </div>
                      <button onClick={() => setShowSkillsList(false)} className="text-white/30 hover:text-white transition-colors"><X size={11} /></button>
                    </div>
                    <div className="px-2 pb-2 space-y-1 max-h-[180px] overflow-y-auto scrollbar-thin">
                      {activeSkills.map((skill, i) => (
                        <div key={skill.name || i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/30 border border-indigo-500/10 hover:border-indigo-500/30 transition-colors group">
                          <CheckCircle2 size={10} className="text-indigo-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-white/90">{skill.name}</span>
                              <span className="text-[8px] px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">{skill._source || skill.source || 'local'}</span>
                            </div>
                            {(skill.description || skill.content) && (
                              <p className="text-[9px] text-white/30 truncate mt-0.5 font-mono group-hover:text-white/50 transition-colors">
                                {skill.description || skill.content.replace(/^---[\s\S]*?---\n?/, '').replace(/^#+[^\n]*\n/, '').replace(/[#*`]/g, '').trim().slice(0, 120)}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="p-4">
                <div className="flex flex-col gap-3">
                  {/* AI Control Bar */}
                  {aiMode === 'auto' && (
                    <div className="flex items-center justify-end gap-2 px-1">

                         {!autoMode && aiMode === 'auto' && (
                           <button 
                             disabled={skillsSearchLoading}
                             onClick={() => {
                               if (skillsSearchLoading) return;
                               const currentGoal = String(autoGoal || aiPrompt || '').trim();
                               const lastGoal = String(lastGoalRef.current || '').trim();
                               const isNewGoal = currentGoal !== lastGoal && currentGoal.length > 2;
                               const isSkillsResume = skillsJustInjectedRef.current;

                               if (isNewGoal || isSkillsResume) {
                                  // 🚀 FULL RESET: Goal changed OR skills were just injected (SSH may be dead, start fresh)
                                  const reason = isSkillsResume ? 'Skills injected -> Fresh start' : 'New goal detected';
                                  console.log(`[Auto Mode] ${reason} -> Performing Full Task Reset`);
                                  skillsJustInjectedRef.current = false;
                                  autoSeenRef.current = new Set();
                                  autoVerifyKeyRef.current = '';
                                  autoLastLoopKeyRef.current = '';
                                  autoLoopRepeatRef.current = 0;
                                  autoRepeatSigRef.current = { key: '', count: 0 };
                                  autoSameCommandRef.current = { cmd: '', count: 0 };
                                  autoEmptyRetryRef.current = '';
                                  autoBlockerRef.current = { kind: null, count: 0 };
                                  aiConversationRef.current = []; // Wipe conversation — SSH dead, start fresh
                                  autoRecentCommandsRef.current = [];
                                  detectedOsRef.current = null;
                                  lastGoalRef.current = currentGoal;
                                  setAutoStepHistory([]);
                                  setAutoStepsRemaining(MAX_AUTO_STEPS);
                                  
                                  if (isNewGoal) {
                                    preloadedSkillsRef.current = [];
                                    mentionedFilesRef.current = extractMentionedPaths(currentGoal);
                                    if (sshAiPrefs?.aiTask !== 'code') {
                                      fetchSkillsForGoal(currentGoal).then(({ skills, allAvailable }) => {
                                          preloadedSkillsRef.current = skills;
                                          setActiveSkills(skills);
                                          if (skills.length > 0) {
                                              setInjectedSkills({ skills, allAvailable });
                                              setTimeout(() => setInjectedSkills(null), 5000);
                                          }
                                      });
                                    }
                                  }
                               } else {
                                  // 🚀 SAME GOAL: Emergency Reset of stuck counters only
                                  autoEmptyRetryRef.current = '';
                                  autoLoopRepeatRef.current = 0;
                                  autoRepeatSigRef.current = { key: '', count: 0 };
                                  autoSameCommandRef.current = { cmd: '', count: 0 };
                               }
                               
                               suppressInteractiveUntilRef.current = Date.now() + 4000;
                               autoModeRef.current = true;
                               bypassPasswordPauseRef.current = true;
                               setAiError(null);
                               setAutoMode(true);
                               setLastResultAt(p => { const n = Date.now(); return n > (p || 0) ? n : (p || 0) + 1; });
                               setTimeout(() => {
                                 autoRunningRef.current = false;
                                 // Build a specific resume nudge based on WHY we paused
                                 let resumeNudge = '\n\n(RESUMED: Please provide your next <command> or <diff> immediately to continue the task.)';
                                 if (!isNewGoal && !isSkillsResume) {
                                   const { reason, pendingCommand } = pauseReasonRef.current;
                                   if (reason && /(password|passphrase)/i.test(reason)) {
                                     const cmdHint = pendingCommand ? ` Your pending command was: \`${pendingCommand}\`` : '';
                                     resumeNudge = `\n\n(RESUMED after sudo/password pause: The user has handled the authentication (NOPASSWD may now be configured or the password was entered).${cmdHint} Continue from where you left off — if the command needed sudo, try it now. Do NOT restart from scratch.)`;
                                   }
                                   pauseReasonRef.current = { reason: null, pendingCommand: null }; // consume
                                 }
                                 runAutoStep(null, (isNewGoal || isSkillsResume)
                                    ? '\n\n(FRESH START: Previous session cleared. Begin from scratch with the current terminal state and injected skills.)'
                                    : resumeNudge);
                               }, 300);
                             }}
                             className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black tracking-widest uppercase transition-all shadow-sm ${
                               skillsSearchLoading
                                 ? 'bg-white/3 border-white/5 text-white/25 cursor-not-allowed'
                                 : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:text-white active:scale-95'
                             }`}
                           >
                             {skillsSearchLoading ? (
                               <>
                                 <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                                 LOADING
                               </>
                             ) : (
                               <>
                                 <RefreshCw size={11} />
                                 RESUME ENGINE
                               </>
                             )}
                           </button>
                         )}
                        
                        {autoMode && autoCountdown === 0 && (
                          <button 
                            onClick={() => {
                               // Reset stall memory for force-step too
                               autoEmptyRetryRef.current = '';
                               autoLoopRepeatRef.current = 0;
                               
                               autoRunningRef.current = false;
                               runAutoStep(null, '\n\n(FORCE RESUME: Provide an action tag [<command>, <diff>, or <done>] immediately.)');
                             }}
                             className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black tracking-widest uppercase hover:bg-emerald-500/20 active:scale-95 transition-all shadow-sm"
                             title={t('ai.forceNextStep')}
                           >
                             <CornerDownLeft size={11} />
                             FORCE STEP
                           </button>
                         )}

                         {activeSkills.length > 0 && (
                           <button 
                             onClick={() => setShowSkillsList(prev => !prev)}
                             className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-black tracking-widest uppercase transition-all shadow-sm ${showSkillsList ? 'bg-indigo-500 border-indigo-400 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/80'}`}
                             title={t('ai.viewActiveSkills')}
                           >
                             <Brain size={11} />
                             {activeSkills.length} SKILLS
                           </button>
                         )}

                        <button
                          title={t('ai.clearAiHistory')}
                          onClick={() => {
                            // Full nuclear reset
                            skillsJustInjectedRef.current = false;
                            autoSeenRef.current = new Set();
                            autoVerifyKeyRef.current = '';
                            autoLastLoopKeyRef.current = '';
                            autoLoopRepeatRef.current = 0;
                            autoRepeatSigRef.current = { key: '', count: 0 };
                            autoSameCommandRef.current = { cmd: '', count: 0 };
                            autoEmptyRetryRef.current = '';
                            autoBlockerRef.current = { kind: null, count: 0 };
                            aiConversationRef.current = [];
                            autoRecentCommandsRef.current = [];
                            detectedOsRef.current = null;
                            lastGoalRef.current = '';
                            preloadedSkillsRef.current = [];
                            autoSessionBackupIdRef.current = null;
                            autoRunningRef.current = false;
                            if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
                            setAutoStepHistory([]);
                            setAutoStepsRemaining(MAX_AUTO_STEPS);
                            setAutoMode(false);
                            autoModeRef.current = false;
                            setAiError(null);
                            setAutoCountdown(0);
                            setAiAnswer(null);
                            setActiveSkills([]);
                            setShowSkillsList(false);
                            setInjectedSkills(null);
                            setInteractivePrompt(null);
                            console.log('[Auto Mode] FULL RESET by user');
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black tracking-widest uppercase hover:bg-rose-500/20 active:scale-95 transition-all shadow-sm"
                        >
                          <RefreshCw size={11} />
                          RESET
                        </button>

                        {autoCountdown > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-bold animate-pulse">Wait: {autoCountdown}s</span>
                            <button 
                              onClick={() => {
                                if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
                                setAutoCountdown(0);
                                runAutoStep();
                              }}
                              className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-bold hover:bg-amber-500/20 active:scale-95 transition-all"
                            >
                              CONTINUE NOW
                            </button>
                          </div>
                        )}
                    </div>
                  )}

                  {/* Primary Input Box */}
                  <div className="relative">
                  {/* @Mention file picker dropdown */}
                  {aiMention.active && aiMention.results.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-1.5 z-[9999] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-white/30 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <AtSign size={10} className="text-indigo-400" /> Mention File
                        <span className="ml-auto text-[9px] opacity-40">↑↓ navigate · Enter/Tab select · Esc close</span>
                      </div>
                      <div className="overflow-y-auto max-h-44 custom-scrollbar">
                        {aiMention.results.map((file, i) => {
                          const isDir = file.longname?.startsWith('d');
                          return (
                            <button
                              key={file.filename}
                              onMouseDown={e => { e.preventDefault(); insertAiMention(file); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                                i === aiMention.selectedIndex
                                  ? 'bg-indigo-500/20 text-indigo-300'
                                  : 'hover:bg-white/5 text-white/70'
                              }`}
                            >
                              {isDir
                                ? <Folder size={13} className="text-blue-400 shrink-0" />
                                : <FileIconAi size={13} className="text-white/30 shrink-0" />}
                              <span className="truncate font-mono text-[11px]">{file.filename}</span>
                              {isDir && <span className="ml-auto text-[9px] text-blue-400/50 uppercase shrink-0">dir</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className={`flex gap-2 bg-[var(--bg-primary)] border border-white/5 rounded-2xl p-1.5 shadow-2xl transition-all focus-within:border-indigo-500/40 focus-within:ring-4 focus-within:ring-indigo-500/5 ${(!isLoggedIn || aiLimitHit) ? 'opacity-50 grayscale' : ''}`}>
                    {aiMode === 'auto' ? (
                      <div className="flex-1 flex flex-col px-3 py-1 min-w-0">
                        <div className="flex flex-col flex-1 gap-1.5 opacity-60">
                          <span className="text-[8px] font-black tracking-widest text-emerald-500 opacity-70 shrink-0">{t('ai.goal').toUpperCase()}</span>
                          {autoGoal.length > 0 && (
                            <span className="text-[8px] text-white/20 ml-auto">{autoGoal.length} chars</span>
                          )}
                        </div>
                        <textarea
                          ref={autoGoalRef}
                          value={autoGoal}
                          onChange={(e) => {
                            const val = e.target.value;
                            const pos = e.target.selectionStart;
                            setAutoGoal(val);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
                            handleAiMentionDetect(val, pos, 'goal');
                          }}
                          onKeyDown={(e) => {
                            if (handleAiMentionKeyDown(e)) return;
                            if (e.key === 'Enter' && !e.shiftKey && !autoMode) {
                              e.preventDefault();
                              // trigger start
                              document.querySelector('[data-ai-submit]')?.click();
                            }
                          }}
                          onClick={() => setAiMention(prev => ({ ...prev, active: false }))}
                          disabled={!isLoggedIn || aiLimitHit || autoMode}
                          rows={1}
                          className="w-full bg-transparent text-xs outline-none text-[var(--text-primary)] font-medium placeholder:text-white/20 resize-none leading-relaxed scrollbar-none"
                          style={{ height: 'auto', minHeight: '22px', maxHeight: '96px' }}
                          placeholder={t('ai.goalPlaceholder')}
                        />
                      </div>
                    ) : (
                      <div className="flex-1 flex items-start gap-2 px-2 pt-1 min-w-0">
                        <button className="p-1.5 text-white/40 hover:text-white/80 transition-colors shrink-0 mt-0.5" onClick={() => setAiHistoryOpen(true)} title={t('ai.history')}>
                          <Clock size={14} />
                        </button>
                        <textarea
                          ref={aiPromptRef}
                          value={aiPrompt}
                          onChange={(e) => {
                            const val = e.target.value;
                            const pos = e.target.selectionStart;
                            setAiPrompt(val);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                            handleAiMentionDetect(val, pos, 'prompt');
                          }}
                          disabled={!isLoggedIn || aiLimitHit || aiLoading}
                          rows={1}
                          onKeyDown={(e) => {
                            if (handleAiMentionKeyDown(e)) return;
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAskAi();
                            }
                          }}
                          onClick={() => setAiMention(prev => ({ ...prev, active: false }))}
                          className="flex-1 bg-transparent py-2 text-xs outline-none resize-none text-[var(--text-primary)] font-medium placeholder:text-white/20 leading-relaxed scrollbar-none"
                          style={{ height: 'auto', minHeight: '28px', maxHeight: '120px' }}
                          placeholder={t('ai.promptPlaceholder')}
                        />
                      </div>
                    )}
                    
                    {/* Primary Action Button */}
                    <button
                      data-ai-submit
                      onClick={() => {
                        if (aiMode === 'auto') {
                          if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                          if (aiLimitHit && !autoMode) { setAiError('Daily AI limit reached.'); return; }
                          if (!autoMode) {
                            const _goalText = String(autoGoal || aiPrompt || '').trim();

                            // Code Editor mode: require an @file mention in the goal
                            if (sshAiPrefs?.aiTask === 'code' && !_goalText.includes('@')) {
                              setNoMentionWarning(true);
                              setTimeout(() => setNoMentionWarning(false), 4000);
                              if (autoGoalRef.current) {
                                handleAiMentionDetect(_goalText + '@', _goalText.length + 1, 'goal');
                                setAutoGoal(prev => prev + '@');
                                setTimeout(() => autoGoalRef.current?.focus(), 0);
                              }
                              return;
                            }
                            setNoMentionWarning(false);

                            autoSeenRef.current = new Set();
                            autoVerifyKeyRef.current = '';
                            autoLastLoopKeyRef.current = '';
                            autoLoopRepeatRef.current = 0;
                            autoRepeatSigRef.current = { key: '', count: 0 };
                            autoSameCommandRef.current = { cmd: '', count: 0 };
                            autoEmptyRetryRef.current = '';
                            autoBlockerRef.current = { kind: null, count: 0 };
                            aiConversationRef.current = []; // Fresh context for new goal
                            autoRecentCommandsRef.current = []; // Clear cmd history
                            detectedOsRef.current = null; // Re-detect OS for new session
                            autoSessionBackupIdRef.current = Date.now().toString(36); // Fresh backup ID for this session
                            preloadedSkillsRef.current = null; // will be set below
                            setAiDone(false);
                            setAiDoneSummary(null);
                            lastGoalRef.current = String(autoGoal || aiPrompt || '').trim();
                            setAutoStepHistory([]);
                            setAiError(null);
                            setAutoGoal(g => String(g || aiPrompt || '').trim());
                            setAutoStepsRemaining(MAX_AUTO_STEPS);
                            setLastResultSnapshot(s => s || getOutputContext());

                            // ── Extract @mentioned file paths for patch accuracy ──
                            const _goalForSkills = String(autoGoal || aiPrompt || '').trim();
                            mentionedFilesRef.current = extractMentionedPaths(_goalForSkills);

                            // === NEW STRATEGY: Pure AI first, skills on failure ===
                            // Start with NO skills - let AI try to solve the task
                            // Skills will be injected mid-session if AI fails
                            preloadedSkillsRef.current = [];
                            setActiveSkills([]);
                            setSkillsSearchLoading(false);
                            skillInjectionAttemptsRef.current = 0; // Track injection attempts
                            console.log('[Skills] Starting with pure AI (no skills) - will inject on failure');
                            
                            setAutoMode(true);
                            setLastResultAt(() => Date.now() + Math.random());
                            autoRunningRef.current = false;
                            const startDelay = calculateDynamicWait(false, false, false) * 200;
                            setTimeout(() => {
                              if (autoModeRef.current && !autoRunningRef.current) runAutoStep();
                            }, startDelay);

                          } else {
                            setAutoMode(false);
                          }
                        } else {
                          handleAskAi();
                        }
                      }}
                      disabled={!isLoggedIn || aiLimitHit || (aiMode === 'manual' && (!aiPrompt.trim() || aiLoading))}
                      className={`self-start mt-1 shrink-0 h-10 w-10 rounded-xl transition-all active:scale-90 flex items-center justify-center ${
                        aiMode === 'auto' 
                          ? (autoMode ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' : 'bg-emerald-500 text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.2)]')
                          : 'bg-indigo-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)] hover:bg-indigo-500'
                      }`}
                    >
                      {aiMode === 'auto' 
                         ? (autoMode ? <X size={18} strokeWidth={3} /> : <CornerDownLeft size={18} strokeWidth={3} />)
                         : (aiLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} strokeWidth={2} />)
                      }
                    </button>
                  </div>
                  </div>{/* end relative wrapper for @mention */}
                  
                  {/* Footer Hint */}
                  {noMentionWarning ? (
                    <div className="p-3 text-[10px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl leading-relaxed">
                      <span>{t('ai.codeModeMention').split('@filename').map((part, i, arr) => 
                        i < arr.length - 1 ? [part, <span key={i} className="font-mono bg-amber-500/20 px-1 rounded">@filename</span>] : part
                      )}</span>
                    </div>
                  ) : !isLoggedIn ? (
                    <div className="text-center text-[9px] text-amber-400/60 font-medium uppercase tracking-tighter">{t('ai.loginToExecute')}</div>
                  ) : aiLimitHit ? (
                    <div className="text-center text-[9px] text-rose-400/60 font-medium uppercase tracking-tighter">{t('ai.dailyLimitReached')}</div>
                  ) : (
                    <div className="flex items-center justify-between px-2 text-[9px] text-white/30 font-medium uppercase tracking-tighter">
                       <span>{aiMode === 'auto' ? t('ai.goalModeActive') : (sshAiPrefs.aiTask === 'code' ? t('ai.codeEditorMode') : t('ai.usesLastOutput'))}</span>
                       <span className={sshAiPrefs.aiTask === 'code' ? 'text-emerald-400/50' : ''}>{sshAiPrefs.aiTask === 'code' ? t('ai.fileEditMode') : t('ai.terminalContextAttached')}</span>
                    </div>
                  )}
                </div>
                </div>
              </div>
            </div>
          </Rnd>,
          document.body
        )}
      </div>
    </div>
  );
}
