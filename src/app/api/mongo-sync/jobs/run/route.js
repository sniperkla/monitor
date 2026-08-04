import { NextResponse } from 'next/server';
import { executeMongoSyncJob } from '@/lib/mongoSyncJobRunner';

export async function POST(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Job id is required' }, { status: 400 });
  }
  return await executeMongoSyncJob(request, jobId);
}
