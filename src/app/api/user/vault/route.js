import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { auditLog } from "@/lib/auditLog";

/**
 * GET /api/user/vault
 * 
 * Returns the encrypted vault data for the current user.
 * The server has NO way to decrypt this — only the user's Master Password can.
 */
export async function GET(request) {
  let session = null;
  try {
    session = await getServerSession(authOptions);
    if (!session) {
      await auditLog({
        req: request,
        action: 'vault.unlock',
        userId: null,
        detail: { reason: 'unauthenticated' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Careful with what this entry means: it records that the ciphertext was
    // handed over, NOT that the master password was correct. Verification is
    // client-side via the AES-GCM tag, so the server never learns whether an
    // unlock attempt succeeded. A run of these with no subsequent activity is
    // still worth investigating — it means someone is harvesting the blob.
    await auditLog({
      req: request,
      action: 'vault.unlock',
      userId: String(user._id),
      userEmail: session.user?.email,
      detail: { isConfigured: !!user.vault?.isConfigured },
      target: String(user._id),
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      data: {
        vault: {
          // The client needs the encrypted payload and KDF salt/IV to decrypt
          // locally after the user enters the master password. Never return
          // passwordHash: it is an offline verifier and is not required by the
          // decryption operation; exposing it turns a session compromise into
          // a directly checkable password-cracking oracle.
          encryptedUri: user.vault?.encryptedUri || '',
          salt: user.vault?.salt || '',
          iv: user.vault?.iv || '',
          isConfigured: user.vault?.isConfigured || false,
        },
        // Include legacy URI for migration detection/pre-filling
        hasLegacyUri: !!user.privateDbUri,
        legacyUri: user.privateDbUri || '',
      }
    });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'vault.unlock',
      userId: String(session?.user?.id || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
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
  let session = null;
  try {
    session = await getServerSession(authOptions);
    if (!session) {
      await auditLog({
        req: request,
        action: 'vault.setup',
        userId: null,
        detail: { reason: 'unauthenticated' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { encryptedUri, salt, iv, passwordHash } = await request.json();

    // Validate required fields
    if (!encryptedUri || !salt || !iv || !passwordHash) {
      await auditLog({
        req: request,
        action: 'vault.setup',
        userId: String(session.user?.id || ''),
        userEmail: session.user?.email,
        detail: { reason: 'missing_parameters' },
        status: 'failure',
      });
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

    // Metadata only. The ciphertext, salt, IV and passwordHash are all
    // secrets in their own right — the useful audit fact is that the vault
    // was (re)initialised, not what it now contains.
    await auditLog({
      req: request,
      action: 'vault.setup',
      userId: String(session.user?.id || ''),
      userEmail: session.user?.email,
      detail: { bytes: String(encryptedUri || '').length },
      status: 'success',
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Vault encrypted and stored securely' 
    });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'vault.setup',
      userId: String(session?.user?.id || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/user/vault
 * 
 * Clears the vault (used during recovery reset).
 */
export async function DELETE(request) {
  let session = null;
  try {
    session = await getServerSession(authOptions);
    if (!session) {
      await auditLog({
        req: request,
        action: 'vault.clear',
        userId: null,
        detail: { reason: 'unauthenticated' },
        status: 'failure',
      });
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

    await auditLog({
      req: request,
      action: 'vault.clear',
      userId: String(session.user?.id || ''),
      userEmail: session.user?.email,
      detail: { reason: 'user_requested' },
      status: 'success',
    });

    return NextResponse.json({ success: true, message: 'Vault cleared' });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'vault.clear',
      userId: String(session?.user?.id || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
