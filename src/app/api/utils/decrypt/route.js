import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { decrypt } from '@/utils/encryption';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data } = await req.json();
    if (!data) return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 });

    const decryptedData = { ...data };
    
    // Decrypt sensitive fields
    if (decryptedData.password) decryptedData.password = decrypt(decryptedData.password);
    if (decryptedData.privateKey) decryptedData.privateKey = decrypt(decryptedData.privateKey);
    if (decryptedData.passphrase) decryptedData.passphrase = decrypt(decryptedData.passphrase);

    return NextResponse.json({ success: true, data: decryptedData });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
