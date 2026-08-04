import { NextResponse } from 'next/server';
import { executeMongoSyncJob } from '@/lib/mongoSyncJobRunner';

async function handle(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Job id is required' }, { status: 400 });
  }
  return await executeMongoSyncJob(request, jobId);
}

export async function GET(request) {
  return await handle(request);
}

export async function POST(request) {
  return await handle(request);
}
