import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { getVirusScanModel } from '@/models/VirusScan';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

const QUARANTINE_DIR = '/var/monitor-quarantine';

/**
 * POST — act on a finding.
 * Body: { scanId, findingId, action }
 * Actions:
 *   quarantine — move file to quarantine dir with 000 perms (files only)
 *   delete     — permanently remove the file
 *   restore    — move a quarantined file back to its original path
 *   ignore     — mark as ignored (no server-side change)
 *   kill       — kill the flagged process (PID)
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;

    let body;
    try { body = await request.json(); } catch (_) {}
    const { scanId, findingId, action } = body || {};
    if (!scanId || !findingId || !action) {
      return NextResponse.json({ success: false, error: 'Missing fields: scanId, findingId, action' }, { status: 400 });
    }

    const db = await connectDB();
    const Model = getVirusScanModel(db);
    const scan = await Model.findOne({ _id: scanId, userId });
    if (!scan) return NextResponse.json({ success: false, error: 'Scan not found' }, { status: 404 });

    const finding = (scan.findings || []).id(findingId);
    if (!finding) return NextResponse.json({ success: false, error: 'Finding not found' }, { status: 404 });

    // ---- Actions that don't need SSH ----
    if (action === 'ignore') {
      finding.status = 'ignored';
      finding.actedAt = new Date();
      await scan.save();
      return NextResponse.json({ success: true, message: 'Finding ignored' });
    }

    // ---- Server-side actions ----
    const sshConfig = await getSshConfig(scan.connectionId, { userId });
    const exec = (cmd) => execCommand(sshConfig, cmd, { timeoutMs: 30000 });
    const q = (s) => `'${String(s).replace(/'/g, `'\''`)}'`;

    if (action === 'kill') {
      if (!finding.pid) return NextResponse.json({ success: false, error: 'Finding has no PID' }, { status: 400 });
      const r = await exec(`kill -9 ${parseInt(finding.pid, 10)} 2>&1; sleep 1; kill -0 ${parseInt(finding.pid, 10)} 2>/dev/null && echo ALIVE || echo DEAD`);
      if (/ALIVE/.test(r.stdout)) {
        return NextResponse.json({ success: false, error: `Process ${finding.pid} could not be killed` }, { status: 500 });
      }
      finding.status = 'resolved';
      finding.actedAt = new Date();
      await scan.save();
      return NextResponse.json({ success: true, message: `Process ${finding.pid} terminated` });
    }

    if (action === 'harden-ssh') {
      // Safely set PermitRootLogin prohibit-password:
      // 1. backup config  2. apply via sed  3. validate with sshd -t
      // 4. reload sshd only if valid, otherwise restore backup.
      const r = await exec(
        `cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-monitor-$(date +%s) && ` +
        `sed -i.bak2 -E 's/^\\s*#?\\s*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && ` +
        `(sshd -t 2>/dev/null || /usr/sbin/sshd -t 2>/dev/null); ` +
        `if [ $? -eq 0 ]; then ` +
        `(systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || service sshd reload 2>/dev/null || service ssh reload 2>/dev/null) && echo HARDENED || echo RELOAD_FAIL; ` +
        `else mv /etc/ssh/sshd_config.bak2 /etc/ssh/sshd_config && echo VALIDATE_FAIL; fi`
      );
      if (r.stdout.includes('HARDENED')) {
        finding.status = 'resolved';
        finding.actedAt = new Date();
        await scan.save();
        return NextResponse.json({ success: true, message: 'SSH hardened: root login now requires key authentication (config backed up)' });
      }
      const reason = r.stdout.includes('VALIDATE_FAIL')
        ? 'Config validation failed — original config restored'
        : 'Applied config but could not reload sshd automatically — restart sshd manually';
      return NextResponse.json({ success: false, error: reason }, { status: 500 });
    }

    if (!finding.path || finding.path === 'crontab') {
      return NextResponse.json({ success: false, error: 'This finding has no removable file path' }, { status: 400 });
    }

    if (action === 'quarantine') {
      await exec(`mkdir -p ${q(QUARANTINE_DIR)} && chmod 700 ${q(QUARANTINE_DIR)}`);
      const dest = `${QUARANTINE_DIR}/${Date.now()}-${String(finding.path).replace(/\//g, '_')}`;
      const r = await exec(
        `[ -e ${q(finding.path)} ] && mv ${q(finding.path)} ${q(dest)} && chmod 000 ${q(dest)} && chattr +i ${q(dest)} 2>/dev/null; echo OK`
      );
      if (!r.stdout.includes('OK')) {
        return NextResponse.json({ success: false, error: `Failed to move ${finding.path}` }, { status: 500 });
      }
      finding.status = 'quarantined';
      finding.quarantinePath = dest;
      finding.actedAt = new Date();
      await scan.save();
      return NextResponse.json({ success: true, message: `${finding.path} quarantined to ${dest}` });
    }

    if (action === 'delete') {
      const target = finding.quarantinePath || finding.path;
      const r = await exec(`rm -rf ${q(target)} 2>&1; [ -e ${q(target)} ] && echo EXISTS || echo GONE`);
      if (!r.stdout.includes('GONE')) {
        return NextResponse.json({ success: false, error: `Failed to delete ${target}` }, { status: 500 });
      }
      finding.status = 'deleted';
      finding.actedAt = new Date();
      await scan.save();
      return NextResponse.json({ success: true, message: `${target} deleted` });
    }

    if (action === 'restore') {
      if (!finding.quarantinePath) {
        return NextResponse.json({ success: false, error: 'Not quarantined' }, { status: 400 });
      }
      const r = await exec(
        `chattr -i ${q(finding.quarantinePath)} 2>/dev/null; mkdir -p $(dirname ${q(finding.path)}) && mv ${q(finding.quarantinePath)} ${q(finding.path)} && chmod 644 ${q(finding.path)} && echo OK`
      );
      if (!r.stdout.includes('OK')) {
        return NextResponse.json({ success: false, error: 'Restore failed' }, { status: 500 });
      }
      finding.status = 'open';
      finding.quarantinePath = null;
      finding.actedAt = new Date();
      await scan.save();
      return NextResponse.json({ success: true, message: `${finding.path} restored` });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[virus-scan/action] error:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Action failed' }, { status: 500 });
  }
}