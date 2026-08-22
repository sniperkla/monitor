import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { stageBlocklistUpload } from '@/lib/firewallBulkImport';

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const contentType = request.headers.get('content-type') || '';
    let file;

    // Current clients send a raw file body. It is more reliable than multipart
    // uploads through the relay/proxy path, where FormData parsing can fail.
    if (contentType.startsWith('multipart/form-data')) {
      const formData = await request.formData();
      file = formData.get('file');
    } else {
      const bytes = await request.arrayBuffer();
      file = {
        size: bytes.byteLength,
        arrayBuffer: async () => bytes,
      };
    }
    const staged = await stageBlocklistUpload(file);
    return NextResponse.json({ success: true, ...staged });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not stage blocklist file' }, { status: 400 });
  }
}
