import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { broadcastDeploymentStatus } from '@/app/api/deploy/sse/route';
import { getRunning, clearRunning } from '@/lib/deployProcesses';

async function updateStatusToCancelled(projectId, message) {
  try {
    await connectDB(process.env.MONGODB_URI, true);
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
    const setting = await SystemSetting.findOne({ key: dbKey });
    const config = setting?.value || {};
    const now = new Date();
    const finalLog = (config.lastDeployLog || '') + `\n[${now.toISOString()}] ❌ Deployment cancelled by user. ${message || ''}\n`;
    await SystemSetting.findOneAndUpdate({ key: dbKey }, {
      $set: {
        'value.status': 'failed',
        'value.lastDeployLog': finalLog,
        'value.lastDeployAt': now,
        'value.cancelRequested': true,
        'value.deployRunId': null
      }
    });
    await broadcastDeploymentStatus(projectId);
  } catch (err) {
    console.error('[deploy/cancel] Failed to update status after cancellation:', err.message);
  }
}

export async function POST(request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project') || 'default';

    const running = getRunning(projectId);
    if (!running) {
      await updateStatusToCancelled(projectId, 'Cancelled via API (no active process)');
      return NextResponse.json({ success: true, message: 'Cancellation requested' });
    }

    try {
      if (running.type === 'local' && running.proc) {
        try {
          // Terminate the entire process group (negative PID)
          process.kill(-running.proc.pid, 'SIGTERM');
        } catch (e) {
          try { running.proc.kill('SIGTERM'); } catch (err) {
            try { running.proc.kill('SIGKILL'); } catch (err2) {}
          }
        }
      } else if (running.type === 'ssh' && running.conn) {
        // Kill tmux deploy session + cleanup temp files on the remote server
        try {
          const tmuxSession = `deploy-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 60);
          running.conn.exec(`tmux kill-session -t ${tmuxSession} 2>/dev/null; rm -f /tmp/deploy_${tmuxSession}.log /tmp/deploy_tmux_${projectId}.sh; true`, () => {});
        } catch {}
        try { running.conn.end(); } catch (e) { console.warn('[deploy/cancel] Failed to end SSH connection:', e.message); }
      }
    } catch (err) {
      console.error('[deploy/cancel] Error while attempting to cancel:', err.message);
    }

    clearRunning(projectId);
    await updateStatusToCancelled(projectId, 'Cancelled via API');

    return NextResponse.json({ success: true, message: 'Cancellation requested' });
  } catch (err) {
    console.error('[deploy/cancel] POST error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
