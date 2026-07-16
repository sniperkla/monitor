import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import GameProgress from '@/models/GameProgress';

const DEFAULT_PROGRESS = {
  highestLevelReached: 1,
  currentLevel: 1,
  totalWins: 0,
  totalLosses: 0,
  totalGamesPlayed: 0,
  totalNukesLaunched: 0,
  totalKaijuKilled: 0,
  lastOutcome: 'playing',
  lastTheme: 'village',
  lastStats: {}
};

const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(null, true);
    const progress = await GameProgress.findOne({
      userEmail: session.user.email,
      gameKey: 'fallout'
    }).lean();

    return NextResponse.json({
      success: true,
      progress: {
        ...DEFAULT_PROGRESS,
        ...(progress || {})
      }
    });
  } catch (error) {
    console.error('[fallout-progress] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const safeProgress = {
      highestLevelReached: clampNumber(body?.highestLevelReached, 1) || 1,
      currentLevel: clampNumber(body?.currentLevel, 1) || 1,
      totalWins: clampNumber(body?.totalWins, 0),
      totalLosses: clampNumber(body?.totalLosses, 0),
      totalGamesPlayed: clampNumber(body?.totalGamesPlayed, 0),
      totalNukesLaunched: clampNumber(body?.totalNukesLaunched, 0),
      totalKaijuKilled: clampNumber(body?.totalKaijuKilled, 0),
      lastOutcome: ['playing', 'won', 'lost', 'abandoned'].includes(body?.lastOutcome) ? body.lastOutcome : 'playing',
      lastTheme: typeof body?.lastTheme === 'string' ? body.lastTheme.slice(0, 64) : 'village',
      lastStats: typeof body?.lastStats === 'object' && body.lastStats !== null ? body.lastStats : {},
      lastPlayedAt: new Date()
    };

    await connectDB(null, true);
    await GameProgress.findOneAndUpdate(
      {
        userEmail: session.user.email,
        gameKey: 'fallout'
      },
      {
        $set: {
          ...safeProgress,
          userEmail: session.user.email,
          userId: session.user.id || '',
          gameKey: 'fallout'
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[fallout-progress] POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
