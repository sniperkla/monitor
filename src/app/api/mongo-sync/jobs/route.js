import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';

async function getSettingRepo(userId) {
  const db = await connectDB();
  const repo = new SystemSettingRepository(db, userId);
  await repo.init();
  return repo;
}

async function getJobs(repo) {
  const setting = await repo.findOne({ key: 'mongo_sync_jobs' });
  return setting?.value || [];
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const repo = await getSettingRepo(userId);
    const jobs = await getJobs(repo);
    return NextResponse.json({ success: true, data: jobs });

  } catch (error) {
    console.error('Fetch Sync Jobs error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const repo = await getSettingRepo(userId);
    const jobs = await getJobs(repo);
    const body = await request.json();
    const { id, name, connectionId, connectionName, database, collection, driveFolderId, driveFolderName, schedule, enabled = true, targetSshConnId, depWarning = null } = body;

    if (!name || !database || !collection || !driveFolderId) {
      return NextResponse.json({ success: false, error: 'Missing required job parameters' }, { status: 400 });
    }

    let updatedJobs = [...jobs];

    if (id) {
      // Update existing
      const index = updatedJobs.findIndex(j => j.id === id);
      if (index === -1) {
        return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
      }
      updatedJobs[index] = {
        ...updatedJobs[index],
        name, connectionId, connectionName, database, collection,
        driveFolderId, driveFolderName, schedule, enabled, targetSshConnId,
        depWarning,
        updatedAt: Date.now()
      };
    } else {
      // Create new
      const newJob = {
        id: `job-${uuidv4()}`,
        name, connectionId, connectionName, database, collection,
        driveFolderId, driveFolderName, schedule, enabled, targetSshConnId,
        depWarning,
        createdAt: Date.now(), updatedAt: Date.now(),
        lastRun: null, lastStatus: null, lastMessage: null
      };
      updatedJobs.push(newJob);
    }

    await repo.upsert('mongo_sync_jobs', updatedJobs);
    return NextResponse.json({ success: true, data: updatedJobs });

  } catch (error) {
    console.error('Save Sync Job error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Job ID is required' }, { status: 400 });
    }

    const repo = await getSettingRepo(userId);
    const jobs = await getJobs(repo);
    const filteredJobs = jobs.filter(j => j.id !== id);
    await repo.upsert('mongo_sync_jobs', filteredJobs);

    return NextResponse.json({ success: true, data: filteredJobs });

  } catch (error) {
    console.error('Delete Sync Job error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
