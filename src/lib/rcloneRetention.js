/**
 * Build a shell command that applies the backup retention policy:
 * delete ENTIRE backup subfolders older than N days (by folder modtime),
 * instead of the previous `rclone delete --min-age` which only removed
 * individual files inside folders and left the (empty) folders behind.
 *
 * - Lists the target's subfolders with `rclone lsf --dirs-only --format tp`
 *   (RFC3339 modtime | name, "|" separated) and `rclone purge`s each folder
 *   whose modtime is older than the cutoff.
 * - If the target has NO subfolders (flat backup layout), falls back to the
 *   classic file-age cleanup (`delete --min-age ... --rmdirs`).
 * - The newest folder (the current backup) is never touched: only folders
 *   older than the cutoff are purged.
 *
 * The returned snippet is a single shell line, safe to embed both inside the
 * multi-line cron script and in the exec route's one-liner command.
 *
 * @param {object} opts
 * @param {string} opts.target      Base backup target (remote:path) WITHOUT the timestamp folder
 * @param {number} opts.days        Retention window in days
 * @param {string} [opts.driveFlag] Pre-quoted rclone flags (e.g. --drive-root-folder-id "...")
 * @param {string} [opts.logTarget] Log append target: '"$LOG"' inside cron scripts, '/dev/null' otherwise
 * @returns {string} shell command snippet
 */
export function buildRetentionCmd({ target, days, driveFlag = '', logTarget = '/dev/null' }) {
  const df = driveFlag ? `${driveFlag.trim()} ` : '';
  const safeTarget = `'${String(target).replace(/'/g, `'\\''`)}'`;
  const R = '"$RCLONE_BIN"';
  const LOG = logTarget || '/dev/null';
  const log = (msg) => `echo "${msg}" >> ${LOG} 2>/dev/null || true`;

  // Lines are joined with "; " so the snippet works both multi-line (cron
  // script) and as a one-liner (exec route). The while loop is written inline.
  return [
    `RET_TARGET=${safeTarget}`,
    `RET_DAYS=${days}`,
    `CUTOFF=$(date -d "-$RET_DAYS days" +%s 2>/dev/null)`,
    `TMP_LIST=$(mktemp)`,
    `${R} lsf "$RET_TARGET" ${df}--dirs-only --format "tp" --separator "|" 2>>${LOG} > "$TMP_LIST" || true`,
    `DIRS_FOUND=0`,
    `PURGED=0`,
    `while IFS='|' read -r MODT DNAME; do ` +
      `[ -z "$DNAME" ] && continue; DIRS_FOUND=1; ` +
      `MODEPOCH=$(date -d "$MODT" +%s 2>/dev/null) || continue; ` +
      `if [ -n "$MODEPOCH" ] && [ -n "$CUTOFF" ] && [ "$MODEPOCH" -lt "$CUTOFF" ]; then ` +
      `${log('[retention] Purging old backup folder: $RET_TARGET/$DNAME')} ; ` +
      `${R} purge "\${RET_TARGET%/}/$DNAME" ${df}2>>${LOG} || true; PURGED=$((PURGED+1)); fi; done < "$TMP_LIST"`,
    `rm -f "$TMP_LIST"`,
    `if [ "$DIRS_FOUND" -eq 0 ] || [ -z "$CUTOFF" ]; then ` +
      `${log('[retention] No date-able backup subfolders found - cleaning old files instead')} ; ` +
      `${R} delete --min-age ${days}d "$RET_TARGET" ${df}--rmdirs 2>>${LOG} || true; fi`,
  ].join('; ');
}

