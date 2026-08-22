import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand, sftpUpload } from '@/app/api/server-backup/_ssh';
import { getBulkBatch, discardBulkBatch } from '@/lib/firewallBulkImport';
import { buildIpSetApplyScript } from '@/lib/firewallRemoteApply';

const matchesConfirmation = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'confirm' || v === 'apply' || v === 'yes' || v === 'ok' || v.startsWith('confirm');
};
const wantsProgress = (request) => request.headers.get('accept')?.includes('application/x-ndjson');

function progressStream(run) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      Promise.resolve(run(emit))
        .then((result) => emit({ type: 'complete', progress: 100, ...result }))
        .catch((error) => emit({ type: 'error', error: error.message || 'Could not apply blocklist batch' }))
        .finally(() => controller.close());
    },
  });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

function remoteProgressReporter(emit) {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    lines.forEach((line) => {
      const match = line.match(/^MONITOR_PROGRESS\|(\d+)\|(.+)$/);
      if (match) emit({ type: 'progress', progress: Number(match[1]), message: match[2] });
    });
  };
}

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, batchId, confirmation } = await request.json();
    if (!connectionId || !batchId) return NextResponse.json({ success: false, error: 'connectionId and batchId are required' }, { status: 400 });
    if (!matchesConfirmation(confirmation)) return NextResponse.json({ success: false, error: 'Type confirm to confirm this firewall change.' }, { status: 400 });
    const batch = getBulkBatch(batchId);
    if (batch.conflicts.length) return NextResponse.json({ success: false, error: 'Blocked to prevent self-lockout.', conflicts: batch.conflicts }, { status: 409 });

    const remoteFile = `/tmp/monitor-firewall-${batchId}.txt`;
    const runApply = async (emit) => {
      emit?.({ type: 'progress', progress: 5, message: 'Connecting securely to the server' });
      const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
      emit?.({ type: 'progress', progress: 12, message: 'Uploading the validated blocklist' });
      let lastUploadProgress = -1;
      await sftpUpload(sshConfig, batch.filePath, remoteFile, {
        onProgress: (transferred, total) => {
          if (!emit || !total) return;
          const uploadPercent = Math.round((transferred / total) * 100);
          if (uploadPercent === lastUploadProgress) return;
          lastUploadProgress = uploadPercent;
          emit({ type: 'progress', progress: 12 + Math.round(uploadPercent * 0.12), message: `Uploading the validated blocklist (${uploadPercent}%)` });
        },
      });
      emit?.({ type: 'progress', progress: 24, message: 'Upload complete — starting safe replacement' });
      const result = await execCommand(sshConfig, buildIpSetApplyScript(remoteFile), {
        pool: false,
        onStdout: emit ? remoteProgressReporter(emit) : undefined,
      });
      if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Firewall update failed before it could be applied.');
      await discardBulkBatch(batchId);
      return { success: true, entries: batch.entryCount, message: 'Batch blocklist applied and configured to restore after reboot.' };
    };

    if (wantsProgress(request)) return progressStream(runApply);
    const result = await runApply();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not apply blocklist batch' }, { status: 500 });
  }
}
