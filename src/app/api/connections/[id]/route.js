import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt } from '@/utils/encryption';
import { auditLog } from '@/lib/auditLog';
import mongoose from 'mongoose';
import { getClientIp } from '@/lib/clientIp';

const isValidMongoId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET single connection
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = getClientIp(request);
    const rateCheck = checkRateLimit(`connection_opt:${clientIP}`, 120);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);

    if (db.type !== 'mysql' && db.type !== 'postgres' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const connection = await repo.findById(id);

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: connection });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT update connection
export async function PUT(request, { params }) {
  // Outside the try so the catch can still attribute the failure.
  let session = null;
  let id = null;
  try {
    session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = getClientIp(request);
    const rateCheck = checkRateLimit(`connection_opt:${clientIP}`, 120);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    ({ id } = await params);
    const db = await connectDB();
    const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);

    if (db.type !== 'mysql' && db.type !== 'postgres' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();

    // Capture the changed field names before encryption mangles the values.
    // Names only — never values. "Who retargeted connection X at a new host"
    // is the question this answers; the secrets themselves are none of the
    // audit trail's business.
    const changedFields = Object.keys(body || {}).slice(0, 50);

    if (body.password) body.password = encrypt(body.password);
    else delete body.password; // Don't overwrite stored password with empty
    if (body.privateKey) body.privateKey = encrypt(body.privateKey);
    else delete body.privateKey; // Don't overwrite stored key with empty
    if (body.passphrase) body.passphrase = encrypt(body.passphrase);
    else delete body.passphrase; // Don't overwrite stored passphrase with empty
    // SSH tunnel secrets
    if (body.sshTunnelPassword) body.sshTunnelPassword = encrypt(body.sshTunnelPassword);
    if (body.sshTunnelPrivateKey) body.sshTunnelPrivateKey = encrypt(body.sshTunnelPrivateKey);
    if (body.sshTunnelPassphrase) body.sshTunnelPassphrase = encrypt(body.sshTunnelPassphrase);

    const success = await repo.update(id, body);

    if (!success) {
      await auditLog({
        req: request,
        action: 'connection.update',
        userId: String(session?.user?.id || session?.user?.sub || ''),
        userEmail: session?.user?.email,
        detail: { reason: 'not_found', changedFields },
        target: String(id),
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Connection not found or update failed' }, { status: 404 });
    }

    await auditLog({
      req: request,
      action: 'connection.update',
      userId: String(session?.user?.id || session?.user?.sub || ''),
      userEmail: session?.user?.email,
      detail: { changedFields },
      target: String(id),
      status: 'success',
    });

    const updated = await repo.findById(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'connection.update',
      userId: String(session?.user?.id || session?.user?.sub || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      target: id ? String(id) : null,
      status: 'failure',
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE connection
export async function DELETE(request, { params }) {
  let session = null;
  let id = null;
  try {
    session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = getClientIp(request);
    const rateCheck = checkRateLimit(`connection_opt:${clientIP}`, 120);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    ({ id } = await params);
    const db = await connectDB();
    const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);

    if (db.type !== 'mysql' && db.type !== 'postgres' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const connection = await repo.delete(id);

    if (!connection) {
      await auditLog({
        req: request,
        action: 'connection.delete',
        userId: String(session?.user?.id || session?.user?.sub || ''),
        userEmail: session?.user?.email,
        detail: { reason: 'not_found' },
        target: String(id),
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    // Capture identifying metadata before the document is gone — once deleted,
    // the only record of *which* connection was removed is this entry.
    await auditLog({
      req: request,
      action: 'connection.delete',
      userId: String(session?.user?.id || session?.user?.sub || ''),
      userEmail: session?.user?.email,
      detail: {
        name: connection.name,
        type: connection.type || 'ssh',
        host: connection.host,
        port: connection.port,
      },
      target: String(id),
      status: 'success',
    });

    return NextResponse.json({ success: true, data: {} });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'connection.delete',
      userId: String(session?.user?.id || session?.user?.sub || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      target: id ? String(id) : null,
      status: 'failure',
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

