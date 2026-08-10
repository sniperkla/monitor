import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { listGoogleDriveFolders, createGoogleDriveFolder } from '@/lib/gdriveHelper';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id;

    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get('parentId');

    const folders = await listGoogleDriveFolders(parentId || null, userId);
    return NextResponse.json({ success: true, folders });
  } catch (err) {
    console.error('List Drive subfolders error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;

    const body = await request.json();
    const { folderName } = body;

    if (!folderName || !folderName.trim()) {
      return NextResponse.json({ success: false, error: 'Folder name is required' }, { status: 400 });
    }

    const folder = await createGoogleDriveFolder(folderName.trim(), userId);

    return NextResponse.json({
      success: true,
      folderId: folder.id,
      folderName: folder.name
    });
  } catch (error) {
    console.error('Google Drive Folders API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
