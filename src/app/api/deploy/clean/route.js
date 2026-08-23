import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { killRunning, getAllRunning, clearRunning } from '@/lib/deployProcesses';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

/**
 * POST /api/deploy/clean
 *
 * Force-kills all in-memory deploy processes for the authenticated user's projects
 * and resets any stuck 'running' status back to 'idle' in the database.
 *
 * This does NOT stop actual Docker containers or Swarm services — it only kills
 * the Node.js watcher/bash processes spawned by the deploy runner.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);
    await connectDB(process.env.MONGODB_URI, true);

    // Find all deploy config settings for this user
    const settings = await SystemSetting.find({
      ...resolveUserIdQuery(userId),
      key: { $regex: '^auto_deploy_config' }
    }).lean();

    const cleaned = [];
    const now = new Date();

    for (const s of settings) {
      const projectId = s.key === 'auto_deploy_config'
        ? 'default'
        : s.key.replace('auto_deploy_config_', '');

      // Kill any in-memory process for this project
      try {
        killRunning(projectId);
      } catch (_) {}

      // Reset DB status to idle if stuck at running
      if (s.value?.status === 'running') {
        await SystemSetting.findOneAndUpdate(
          { _id: s._id },
          {
            $set: {
              'value.status': 'idle',
              'value.deployRunId': null,
              'value.cancelRequested': false,
              'value.lastDeployLog': (s.value?.lastDeployLog || '') +
                `\n[${now.toISOString()}] 🧹 Deployment forcefully cleaned by user.\n`
            }
          }
        );
        cleaned.push(projectId);
      }
    }

    // Also kill anything in memory that may not have a matching DB entry (orphaned)
    const allRunning = getAllRunning();
    for (const [projectId] of allRunning) {
      try { killRunning(projectId); } catch (_) {}
      if (!cleaned.includes(projectId)) cleaned.push(projectId);
    }

    return NextResponse.json({
      success: true,
      message: cleaned.length > 0
        ? `Cleaned ${cleaned.length} stuck deployment(s): ${cleaned.join(', ')}`
        : 'No stuck deployments found — all projects are already idle.',
      cleaned
    });
  } catch (error) {
    logger.error('[deploy/clean] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
