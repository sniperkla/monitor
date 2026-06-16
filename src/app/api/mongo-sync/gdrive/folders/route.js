import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createGoogleDriveFolder } from '@/lib/gdriveHelper';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { folderName } = body;

    if (!folderName || !folderName.trim()) {
      return NextResponse.json({ success: false, error: 'Folder name is required' }, { status: 400 });
    }

    const folder = await createGoogleDriveFolder(folderName.trim());

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
