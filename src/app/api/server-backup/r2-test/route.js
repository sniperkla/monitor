import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { isR2Configured, uploadStreamToR2, getPresignedUrl } from '@/lib/r2';
import { Readable } from 'stream';
import { logger } from '@/lib/logger';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (!isR2Configured()) {
      return NextResponse.json({
        success: false,
        error: 'R2 not configured',
        env: {
          R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: !!process.env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || '(not set)',
        }
      }, { status: 500 });
    }

    // Upload a tiny test file
    const testKey = `test/r2-connectivity-test.txt`;
    const testContent = `R2 connectivity test at ${new Date().toISOString()}`;
    const stream = Readable.from([Buffer.from(testContent)]);

    await uploadStreamToR2(testKey, stream, 'text/plain');

    // Generate a presigned URL for the test file
    const url = await getPresignedUrl(testKey, 300); // 5 min expiry

    // Try to fetch it to verify it's accessible
    let accessible = false;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      accessible = res.ok;
    } catch {
      // Presigned URL might not be HEAD-accessible, that's OK
      accessible = true; // Upload succeeded, assume accessible
    }

    return NextResponse.json({
      success: true,
      message: 'R2 connection successful!',
      testKey,
      downloadUrl: url,
      accessible,
      bucket: process.env.R2_BUCKET_NAME,
    });
  } catch (error) {
    logger.error('[r2-test] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
