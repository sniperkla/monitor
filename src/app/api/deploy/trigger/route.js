import 
 { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { auditLog } from '@/lib/auditLog';
import { authOptions } from '@/lib/auth';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import SystemSetting from "@/models/SystemSetting";
import { runDeployment } from '../webhook/route';
import { getRunning, enqueueDeployment } from '@/lib/deployProcesses';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// Simple per-project rate limiter
const triggerRateLimit = new Map();
const TRIGGER_RATE_WINDOW_MS = 60000;
const TRIGGER_RATE_MAX = 10;

function checkTriggerRateLimit(projectId) {
  const now = Date.now();
  const entry = triggerRateLimit.get(projectId);
  if (!entry || now - entry.windowStart > TRIGGER_RATE_WINDOW_MS) {
    triggerRateLimit.set(projectId, { windowStart: now, count: 1 });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > TRIGGER_RATE_MAX) {
    const resetIn = TRIGGER_RATE_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, resetIn };
  }
  return { allowed: true };
}

export async function GET(request) {
  return handleTrigger(request);
}

export async function POST(request) {
  return handleTrigger(request);
}

async function handleTrigger(request) {
  try {
    const { searchParams } = new URL(request.url);
    let projectId = searchParams.get('project') || 'default';
    const secretToken = searchParams.get('token');
    const webhookToken = searchParams.get('webhook_token');
    let dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    logger.info(`[trigger] Received direct trigger request for project: ${projectId}`);

    // 1. Fetch deployment config from global/center database
    await connectDB(process.env.MONGODB_URI, true);
    let setting;
    if (webhookToken) {
      // Token-based lookup: find project by webhookToken
      const allSettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
      setting = allSettings.find(s => s.value?.webhookToken === webhookToken);
      if (!setting) {
        return NextResponse.json({ success: false, error: 'Invalid webhook token' }, { status: 404 });
      }
      dbKey = setting.key;
      projectId = dbKey === 'auto_deploy_config' ? 'default' : dbKey.replace('auto_deploy_config_', '');
    } else {
      const session = await getServerSession(authOptions);
      if (!session && !secretToken) {
        logger.info(`[trigger] ❌ No secret configured and no session — rejecting unauthenticated trigger`);
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      const userId = normalizeUserId(session?.user?.id || session?.user?.sub || session?.user?.email);
      const userIdQuery = resolveUserIdQuery(userId);
      setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    }
    const config = setting?.value;

    // 2. Security validation: require secret token OR authenticated session (BEFORE any config checks)
    if (config?.secret) {
      if (!secretToken || !timingSafeCompare(secretToken, config.secret)) {
        logger.info(`[trigger] ❌ Invalid or missing secret token for project: ${projectId}`);
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      const session = await getServerSession(authOptions);
      if (!session) {
        logger.info(`[trigger] ❌ No secret configured and no session — rejecting unauthenticated trigger`);
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    // 3. Now check config state (only reachable by authenticated users)
    if (!config) {
      logger.info(`[trigger] ❌ Project config for "${projectId}" not found`);
      return NextResponse.json({ success: false, error: `Project "${projectId}" not found or deployment not configured` }, { status: 404 });
    }

    if (!config.enabled) {
      logger.info(`[trigger] ❌ Deployment is disabled for project: ${projectId}`);
      return NextResponse.json({ success: false, error: `Auto-deployment for project "${projectId}" is disabled` }, { status: 400 });
    }

    if (!config.deployCommand?.trim()) {
      logger.info(`[trigger] ❌ No deployment command configured for project: ${projectId}`);
      return NextResponse.json({ success: false, error: 'Deployment command is not configured' }, { status: 400 });
    }

    // 3. Check for active or concurrent deployments
    if (config.status === 'running') {
      const activeProcess = getRunning(projectId);
      if (!activeProcess) {
        logger.info(`[trigger] Stale running state detected for project: ${projectId}. Resetting status.`);
        await SystemSetting.findOneAndUpdate(
          { key: dbKey },
          {
            $set: {
              'value.status': 'idle',
              'value.deployRunId': null,
              'value.cancelRequested': false
            }
          }
        );
      }
      // No longer reject — let the queue handle it
    }

    // 4. Trigger in background with rate limit check
    const rateCheck = checkTriggerRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json({ success: false, error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` }, { status: 429 });
    }

    logger.info(`[trigger] ✅ Launching deployment in background for project: ${projectId}`);
    enqueueDeployment(projectId, async () => {
      await runDeployment(config, {
        triggerSource: 'Direct Trigger URL (curl/script)'
      });
    }).catch(err => {
      logger.error('[trigger] Queued deployment error:', err.message);
    });

    return NextResponse.json({ 
      success: true, 
      message: `Deployment triggered successfully for project "${projectId}"`
    });

  } catch (error) {
    logger.error('[deploy/trigger] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
