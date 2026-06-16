import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import SystemSetting from '@/models/SystemSetting';
import { v4 as uuidv4 } from 'uuid';

async function getJobs(settingRepo) {
  const jobsSetting = await settingRepo.findOne({ key: 'mongo_sync_jobs' });
  return jobsSetting ? jobsSetting.value : [];
}

async function saveJobs(jobs) {
  await connectDB();
  await SystemSetting.findOneAndUpdate(
    { key: 'mongo_sync_jobs' },
    { key: 'mongo_sync_jobs', value: jobs },
    { upsert: true, new: true }
  );
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db);
    await settingRepo.init();
    const jobs = await getJobs(settingRepo);

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

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db);
    await settingRepo.init();
    const jobs = await getJobs(settingRepo);

    const body = await request.json();
    const { id, name, connectionId, connectionName, database, collection, driveFolderId, driveFolderName, schedule, enabled = true } = body;

    if (!name || !database || !collection || !driveFolderId) {
      return NextResponse.json({ success: false, error: 'Missing required job parameters' }, { status: 400 });
    }

    let updatedJobs = [...jobs];

    if (id) {
      // Update
      const index = updatedJobs.findIndex(j => j.id === id);
      if (index === -1) {
        return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
      }
      updatedJobs[index] = {
        ...updatedJobs[index],
        name,
        connectionId,
        connectionName,
        database,
        collection,
        driveFolderId,
        driveFolderName,
        schedule,
        enabled,
        updatedAt: Date.now()
      };
    } else {
      // Create
      const newJob = {
        id: `job-${uuidv4()}`,
        name,
        connectionId,
        connectionName,
        database,
        collection,
        driveFolderId,
        driveFolderName,
        schedule,
        enabled,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRun: null,
        lastStatus: null,
        lastMessage: null
      };
      updatedJobs.push(newJob);
    }

    await saveJobs(updatedJobs);

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

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Job ID is required' }, { status: 400 });
    }

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db);
    await settingRepo.init();
    const jobs = await getJobs(settingRepo);

    const filteredJobs = jobs.filter(j => j.id !== id);
    await saveJobs(filteredJobs);

    return NextResponse.json({ success: true, data: filteredJobs });

  } catch (error) {
    console.error('Delete Sync Job error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
