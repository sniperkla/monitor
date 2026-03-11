import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt } from '@/utils/encryption';
import mongoose from 'mongoose';

const isValidMongoId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET single connection
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connection_opt:${clientIP}`, 120);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db);

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
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connection_opt:${clientIP}`, 120);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db);

    if (db.type !== 'mysql' && db.type !== 'postgres' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();

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
      return NextResponse.json({ success: false, error: 'Connection not found or update failed' }, { status: 404 });
    }

    const updated = await repo.findById(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE connection
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connection_opt:${clientIP}`, 120);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db);

    if (db.type !== 'mysql' && db.type !== 'postgres' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const connection = await repo.delete(id);

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

