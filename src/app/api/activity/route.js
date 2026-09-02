import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
// The activity timeline is system telemetry: always read/write the CENTER DB.
// connectDB() with no args follows the client's x-mongodb-uri vault header,
// which appears only after master-password unlock — that made the log
// "disappear" (it was being read from an empty vault DB).
import connectDB, { getCenterUri } from '@/lib/mongodb';
import ActivityLog, { getActivityLogModel } from '@/models/ActivityLog';

const VALID_CATEGORIES = ['app', 'file', 'server', 'deploy', 'backup', 'sync', 'auth'];
const VALID_STATUSES = ['success', 'error', 'info'];

function getClientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
}

/**
 * GET /api/activity — list the current user's activity timeline.
 * Query params: category, status, q (search), limit (default 50, max 200),
 *               before (ISO date cursor for "load older")
 */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const db = await connectDB(getCenterUri(), true);
    const Model = getActivityLogModel(db);
    const userId = session.user?.id || session.user?.sub;
    const { searchParams } = new URL(request.url);

    const query = { userId };
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const q = searchParams.get('q');
    const before = searchParams.get('before');
    let limit = parseInt(searchParams.get('limit'), 10) || 50;
    limit = Math.min(Math.max(limit, 1), 200);

    if (category && VALID_CATEGORIES.includes(category)) query.category = category;
    if (status && VALID_STATUSES.includes(status)) query.status = status;
    if (before && !isNaN(Date.parse(before))) query.createdAt = { $lt: new Date(before) };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ message: rx }, { target: rx }];
    }

    // `ip` is still recorded on write (it is the point of an audit trail), but
    // it is stripped from reads: this endpoint returns a user's OWN timeline,
    // so shipping the address back buys nothing and turns a telemetry feed
    // into a location-history export.
    const [items, total] = await Promise.all([
      Model.find(query).select('-ip').sort({ createdAt: -1 }).limit(limit).lean(),
      Model.countDocuments({ userId }),
    ]);

    return NextResponse.json({
      success: true,
      items,
      total,
      hasMore: items.length === limit,
      nextCursor: items.length ? items[items.length - 1].createdAt : null,
    });
  } catch (error) {
    console.error('[activity] GET error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to load activity' }, { status: 500 });
  }
}

const MAX_META_BYTES = 2048;

/**
 * POST /api/activity — record a client-side event (app opened/closed, upload finished...).
 * Body: { action, message, category?, target?, status?, meta? }
 * The user identity always comes from the session — never trusted from the body.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { action, message, target, meta } = body;
    const category = VALID_CATEGORIES.includes(body.category) ? body.category : 'app';
    const status = VALID_STATUSES.includes(body.status) ? body.status : 'success';

    if (!action || typeof action !== 'string' || action.length > 100) {
      return NextResponse.json({ success: false, error: 'Missing or invalid field: action' }, { status: 400 });
    }
    if (!message || typeof message !== 'string' || message.length > 300) {
      return NextResponse.json({ success: false, error: 'Missing or invalid field: message' }, { status: 400 });
    }

    // Simple per-user rate limit: max 120 events/min (bursty UIs stay safe)
    const rlKey = `activity:${session.user?.id || session.user?.sub}`;
    const now = Date.now();
    global.__activityRateStore = global.__activityRateStore || new Map();
    const entry = global.__activityRateStore.get(rlKey);
    if (entry && now - entry.windowStart < 60_000) {
      entry.count++;
      if (entry.count > 120) {
        return NextResponse.json({ success: false, error: 'Too many events' }, { status: 429 });
      }
    } else {
      global.__activityRateStore.set(rlKey, { count: 1, windowStart: now });
    }

    const db = await connectDB(getCenterUri(), true);
    const Model = getActivityLogModel(db);
    await Model.create({
      userId: session.user?.id || session.user?.sub,
      username: session.user?.name || session.user?.email || null,
      category,
      action,
      message: String(message).slice(0, 300),
      target: target ? String(target).slice(0, 200) : null,
      status,
      meta: meta && JSON.stringify(meta).length <= MAX_META_BYTES ? meta : null,
      ip: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[activity] POST error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to record activity' }, { status: 500 });
  }
}

/** DELETE /api/activity — clear the current user's own history. */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const db = await connectDB(getCenterUri(), true);
    const Model = getActivityLogModel(db);
    const res = await Model.deleteMany({ userId: session.user?.id || session.user?.sub });
    return NextResponse.json({ success: true, deleted: res.deletedCount ?? 0 });
  } catch (error) {
    console.error('[activity] DELETE error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to clear activity' }, { status: 500 });
  }
}