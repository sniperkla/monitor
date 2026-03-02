import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { getSshMemoryModel } from '@/models/SshMemory';

// ── GET /api/ssh/memory?host=xxx ──────────────────────────────────────────────
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const host = searchParams.get('host');
    if (!host) return NextResponse.json({ success: false, error: 'host required' }, { status: 400 });

    const db = await connectDB();
    const SshMemory = getSshMemoryModel(db);

    const mem = await SshMemory.findOne({ userId: session.user.email, host }).lean();
    return NextResponse.json({ success: true, memory: mem || null });
  } catch (e) {
    console.error('SshMemory GET error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ── PATCH /api/ssh/memory ─────────────────────────────────────────────────────
// Body: { host, facts: { os?, loginUser?, workingDir?, packageManager?,
//          keyPaths?: string[], installedTools?: string[], runningServices?: string[],
//          completedGoal?: { goal, summary, stepsCount },
//          notes?: string[]  } }
export async function PATCH(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { host, facts = {}, label } = body;
    if (!host) return NextResponse.json({ success: false, error: 'host required' }, { status: 400 });

    const db = await connectDB();
    const SshMemory = getSshMemoryModel(db);

    const setFields = { lastSeenAt: new Date() };
    const pushFields = {};
    const addToSetFields = {};

    if (facts.os)             setFields.os             = String(facts.os).slice(0, 100);
    if (facts.loginUser)      setFields.loginUser      = String(facts.loginUser).slice(0, 80);
    if (facts.workingDir)     setFields.workingDir     = String(facts.workingDir).slice(0, 200);
    if (facts.packageManager) setFields.packageManager = String(facts.packageManager).slice(0, 40);
    if (label)                setFields.label          = String(label).slice(0, 120);

    // Array merges (addToSet prevents duplicates)
    if (Array.isArray(facts.keyPaths) && facts.keyPaths.length) {
      addToSetFields.keyPaths = { $each: facts.keyPaths.map(p => String(p).slice(0, 200)).slice(0, 20) };
    }
    if (Array.isArray(facts.installedTools) && facts.installedTools.length) {
      addToSetFields.installedTools = { $each: facts.installedTools.map(t => String(t).slice(0, 80)).slice(0, 30) };
    }
    if (Array.isArray(facts.runningServices) && facts.runningServices.length) {
      addToSetFields.runningServices = { $each: facts.runningServices.map(s => String(s).slice(0, 80)).slice(0, 20) };
    }

    // Completed goal — push + cap at 20
    if (facts.completedGoal && facts.completedGoal.goal) {
      pushFields.completedGoals = {
        $each: [{
          goal:       String(facts.completedGoal.goal).slice(0, 200),
          summary:    String(facts.completedGoal.summary || '').slice(0, 400),
          stepsCount: Number(facts.completedGoal.stepsCount) || 0,
          completedAt: new Date(),
        }],
        $slice: -20,
      };
    }

    // AI notes — push + cap at 50
    if (Array.isArray(facts.notes) && facts.notes.length) {
      pushFields.notes = {
        $each: facts.notes.slice(0, 5).map(n => ({
          content: String(n).slice(0, 400),
          source: 'ai',
          addedAt: new Date(),
        })),
        $slice: -50,
      };
    }

    // Reminders — addToSet by title+command combo
    if (facts.reminder && facts.reminder.title && facts.reminder.command) {
      addToSetFields.reminders = {
        title: String(facts.reminder.title).slice(0, 100),
        command: String(facts.reminder.command).slice(0, 500),
        category: String(facts.reminder.category || 'general').slice(0, 40),
        addedAt: new Date()
      };
    }

    const update = {
      $set: setFields,
      $inc: { sessionCount: 1 },
    };
    if (Object.keys(addToSetFields).length) update.$addToSet = addToSetFields;
    if (Object.keys(pushFields).length)    update.$push     = pushFields;

    const mem = await SshMemory.findOneAndUpdate(
      { userId: session.user.email, host },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return NextResponse.json({ success: true, memory: mem });
  } catch (e) {
    console.error('SshMemory PATCH error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ── DELETE /api/ssh/memory?host=xxx ──────────────────────────────────────────
export async function DELETE(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const host = searchParams.get('host');
    if (!host) return NextResponse.json({ success: false, error: 'host required' }, { status: 400 });

    const db = await connectDB();
    const SshMemory = getSshMemoryModel(db);
    await SshMemory.deleteOne({ userId: session.user.email, host });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
