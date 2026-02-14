import { NextResponse } from 'next/server';

/**
 * DEPRECATED: This route used to sync database URIs in plain text.
 * It is replaced by the /api/user/vault system which uses zero-knowledge encryption.
 */
export async function POST() {
  return NextResponse.json({ 
    success: false, 
    error: 'This API is deprecated. Please use the zero-knowledge vault system in settings instead.' 
  }, { status: 410 });
}
