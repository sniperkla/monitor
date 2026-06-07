import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SystemSetting from "@/models/SystemSetting";
import { runDeployment } from '../webhook/route';
import { getRunning } from '@/lib/deployProcesses';

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

    if (!config) {
      console.log(`[trigger] ❌ Project config for "${projectId}" not found`);
      return NextResponse.json({ success: false, error: `Project "${projectId}" not found or deployment not configured` }, { status: 404 });
    }

    if (!config.enabled) {
      console.log(`[trigger] ❌ Deployment is disabled for project: ${projectId}`);
      return NextResponse.json({ success: false, error: `Auto-deployment for project "${projectId}" is disabled` }, { status: 400 });
    }

    // 2. Security validation: check secret token if configured
    if (config.secret) {
      if (!token || token !== config.secret) {
        console.log(`[trigger] ❌ Invalid or missing secret token for project: ${projectId}`);
        return NextResponse.json({ success: false, error: 'Unauthorized: Invalid or missing secret token' }, { status: 401 });
      }
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

    // 4. Trigger in background
    console.log(`[trigger] ✅ Launching deployment in background for project: ${projectId}`);
    runDeployment(config, {
      triggerSource: 'Direct Trigger URL (curl/script)'
    }).catch(err => {
      console.error('[trigger] Unhandled background deployment error:', err.message);
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
