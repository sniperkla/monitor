import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";

/**
 * GET /api/user/vault
 * 
 * Returns the encrypted vault data for the current user.
 * The server has NO way to decrypt this — only the user's Master Password can.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        vault: {
          encryptedUri: user.vault?.encryptedUri || '',
          salt: user.vault?.salt || '',
          iv: user.vault?.iv || '',
          passwordHash: user.vault?.passwordHash || '',
          isConfigured: user.vault?.isConfigured || false,
        },
        // Include legacy URI for migration detection/pre-filling
        hasLegacyUri: !!user.privateDbUri,
        legacyUri: user.privateDbUri || '',
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/user/vault
 * 
 * Stores the encrypted vault data. The server receives:
 * - encryptedUri (AES-256-GCM encrypted, hex)
 * - salt (PBKDF2 salt, hex)
 * - iv (GCM nonce, hex)
 * - passwordHash (SHA-256 hash for verification, hex)
 * 
 * The server NEVER receives the plaintext URI or Master Password.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { encryptedUri, salt, iv, passwordHash } = await request.json();

    // Validate required fields
    if (!encryptedUri || !salt || !iv || !passwordHash) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing encryption parameters' 
      }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);

    await User.findOneAndUpdate(
      { email: session.user.email },
      {
        vault: {
          encryptedUri,
          salt,
          iv,
          passwordHash,
          isConfigured: true,
        },
        // Clear legacy field
        privateDbUri: '',
      },
      { new: true }
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Vault encrypted and stored securely' 
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/user/vault
 * 
 * Clears the vault (used during recovery reset).
 */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);

    await User.findOneAndUpdate(
      { email: session.user.email },
      {
        vault: {
          encryptedUri: '',
          salt: '',
          iv: '',
          passwordHash: '',
          isConfigured: false,
        },
        privateDbUri: '',
      }
    );

    return NextResponse.json({ success: true, message: 'Vault cleared' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
