import { execCommand } from '@/app/api/server-backup/_ssh';

/**
 * Detached remote execution for long-running jobs (agent installers).
 *
 * Instead of holding one SSH exec channel open for minutes (which suffers
 * keepalive drops, network blips and blocks the HTTP route), the script is
 * uploaded and launched DETACHED on the host via setsid+nohup writing into a
 * temp log file. This helper then polls that log with short-lived SSH
 * commands, streaming every new line through `onLine`, until the script
 * emits its done marker.
 *
 * If this Node process or the SSH connection dies midway, the remote job
 * keeps running and its output stays available at the returned log path.
 *
 * Returns an execCommand-shaped result: { stdout, stderr, code }.
 */
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

export async function execDetached(sshConfig, script, opts = {}) {
  const { onLine, pollMs = 3000, timeoutMs = 900000 } = opts;
  const id = `agbg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const shPath = `/tmp/.${id}.sh`;
  const logPath = `/tmp/.${id}.log`;
  const wrapped = `${script}\necho "__AGBG_DONE_$?__"\n`;

  const launch = await execCommand(
    sshConfig,
    `echo '${b64(wrapped)}' | base64 -d > ${shPath} && chmod +x ${shPath} && : > ${logPath}` +
    // POSIX sh (not bash) so BusyBox-based images (Alpine etc.) work too
    ` && (setsid nohup sh ${shPath} >> ${logPath} 2>&1 < /dev/null &) && echo LAUNCHED`,
    { pool: false, timeoutMs: 30000 }
  );
  if (!/LAUNCHED/.test(launch.stdout || '')) {
    return { stdout: '', stderr: (launch.stderr || launch.stdout || 'failed to launch background job on host'), code: 1 };
  }

  let cursor = 0;   // byte offset into the remote log already consumed
  let buf = '';     // incomplete trailing line held between polls
  let out = '';
  let exitCode = null;
  const t0 = Date.now();

  while (Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    let r2;
    try {
      r2 = await execCommand(
        sshConfig,
        `tail -c +$((0 + ${cursor} + 1)) ${logPath} 2>/dev/null; printf '\\n__AGBG_POS_%s__\\n' "$(wc -c < ${logPath} 2>/dev/null || echo ${cursor})"`,
        { pool: false, timeoutMs: 30000 }
      );
    } catch { continue; } // transient network hiccup — retry next tick
    if (r2.error || !r2.stdout) continue;

    const raw = r2.stdout;
    const posIdx = raw.lastIndexOf('__AGBG_POS_');
    if (posIdx < 0) continue;
    const pm = raw.slice(posIdx).match(/__AGBG_POS_(\d+)__/);
    if (!pm) continue;
    cursor = parseInt(pm[1], 10) || cursor;
    const chunk = raw.slice(0, posIdx);
    if (!chunk) continue;

    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const ln of lines) {
      const dm = ln.trim().match(/^__AGBG_DONE_(\d+)__$/);
      if (dm) { exitCode = parseInt(dm[1], 10); continue; }
      out += ln + '\n';
      try { onLine?.(ln); } catch { /* listener errors must not kill the poll */ }
    }
    if (exitCode !== null) break;
  }

  // flush any trailing partial line left in the buffer
  if (buf && !/^__AGBG_DONE_\d+__$/.test(buf.trim())) {
    out += buf + '\n';
    try { onLine?.(buf); } catch { /* ignore */ }
  }
  // best-effort cleanup of the uploaded script (log intentionally kept)
  try { await execCommand(sshConfig, `rm -f ${shPath}`, { pool: false, timeoutMs: 10000 }); } catch { /* ignore */ }

  if (exitCode === null) {
    return {
      stdout: out,
      stderr: `background job still running after ${Math.round(timeoutMs / 1000)}s — it keeps running on the host (log: ${logPath})`,
      code: 124,
    };
  }
  return { stdout: out, stderr: '', code: exitCode };
}
