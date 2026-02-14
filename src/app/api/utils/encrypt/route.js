import { NextResponse } from 'next/server';
import { encrypt } from '@/utils/encryption';

export async function POST(req) {
  try {
    const { data } = await req.json();
    if (!data) return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 });

    const encryptedData = { ...data };
    
    // Encrypt sensitive fields
    if (encryptedData.password) encryptedData.password = encrypt(encryptedData.password);
    if (encryptedData.privateKey) encryptedData.privateKey = encrypt(encryptedData.privateKey);
    if (encryptedData.passphrase) encryptedData.passphrase = encrypt(encryptedData.passphrase);

    return NextResponse.json({ success: true, data: encryptedData });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
