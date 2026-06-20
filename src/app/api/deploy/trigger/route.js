import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import SystemSetting from "@/models/SystemSetting";
import { runDeployment } from '../webhook/route';
import { getRunning, tryAcquireStartLock, releaseStartLock } from '@/lib/deployProcesses';

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
    const projectId = searchParams.get('project') || 'default';
    const token = searchParams.get('token');
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    console.log(`[trigger] Received direct trigger request for project: ${projectId}`);

    // 1. Fetch deployment config from global/center database
    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ key: dbKey });
    const config = setting?.value;

    // 2. Security validation: require secret token OR authenticated session (BEFORE any config checks)
    if (config?.secret) {
      if (!token || !timingSafeCompare(token, config.secret)) {
        console.log(`[trigger] ❌ Invalid or missing secret token for project: ${projectId}`);
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      const session = await getServerSession(authOptions);
      if (!session) {
        console.log(`[trigger] ❌ No secret configured and no session — rejecting unauthenticated trigger`);
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    // 3. Now check config state (only reachable by authenticated users)
    if (!config) {
      console.log(`[trigger] ❌ Project config for "${projectId}" not found`);
      return NextResponse.json({ success: false, error: `Project "${projectId}" not found or deployment not configured` }, { status: 404 });
    }

    if (!config.enabled) {
      console.log(`[trigger] ❌ Deployment is disabled for project: ${projectId}`);
      return NextResponse.json({ success: false, error: `Auto-deployment for project "${projectId}" is disabled` }, { status: 400 });
    }

    if (!config.deployCommand?.trim()) {
      console.log(`[trigger] ❌ No deployment command configured for project: ${projectId}`);
      return NextResponse.json({ success: false, error: 'Deployment command is not configured' }, { status: 400 });
    }

    // 3. Check for active or concurrent deployments
    if (config.status === 'running') {
      const activeProcess = getRunning(projectId);
      if (!activeProcess) {
        console.log(`[trigger] Stale running state detected for project: ${projectId}. Resetting status.`);
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
      } else {
        console.log(`[trigger] ❌ Deployment already running for project: ${projectId}`);
        return NextResponse.json({ success: false, error: 'A deployment is already running for this project' }, { status: 409 });
      }
    }

    // 4. Trigger in background with race-condition lock
    const rateCheck = checkTriggerRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json({ success: false, error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` }, { status: 429 });
    }

    if (!tryAcquireStartLock(projectId)) {
      console.log(`[trigger] Deployment start already in progress for project: ${projectId}`);
      return NextResponse.json({ success: false, error: 'A deployment is already starting for this project' }, { status: 409 });
    }

    console.log(`[trigger] ✅ Launching deployment in background for project: ${projectId}`);
    runDeployment(config, {
      triggerSource: 'Direct Trigger URL (curl/script)'
    }).catch(err => {
      console.error('[trigger] Unhandled background deployment error:', err.message);
    }).finally(() => {
      releaseStartLock(projectId);
    });

    return NextResponse.json({ 
      success: true, 
      message: `Deployment triggered successfully for project "${projectId}"`
    });

  } catch (error) {
    console.error('[deploy/trigger] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
