import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand, sftpUpload } from '../_ssh';
import crypto from 'crypto';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export async function POST(request) {
  let tempFile = null;
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file');
    const connectionId = formData.get('connectionId');
    const restorePath = formData.get('restorePath') || '/tmp/restore';
    const restoreType = formData.get('restoreType') || 'files';

    if (!file || !connectionId) {
      return NextResponse.json({ success: false, error: 'Missing file or connectionId' }, { status: 400 });
    }

    const restoreId = crypto.randomUUID().substring(0, 8);
    tempFile = join(tmpdir(), `restore_${restoreId}.tar.gz`);
    const bytes = await file.arrayBuffer();
    await writeFile(tempFile, Buffer.from(bytes));

    const sshConfig = await getSshConfig(connectionId);
    const remotePath = `/tmp/restore_${restoreId}.tar.gz`;

    await sftpUpload(sshConfig, tempFile, remotePath);

    let command;
    if (restoreType === 'database-mongodb') {
      command = `mkdir -p /tmp/dbrestore_${restoreId} && tar -xzf ${remotePath} -C /tmp/dbrestore_${restoreId} && mongorestore /tmp/dbrestore_${restoreId} 2>&1; rm -rf /tmp/dbrestore_${restoreId} ${remotePath}`;
    } else if (restoreType === 'database-mysql') {
      command = `mkdir -p /tmp/dbrestore_${restoreId} && tar -xzf ${remotePath} -C /tmp/dbrestore_${restoreId} && mysql < /tmp/dbrestore_${restoreId}/dump.sql 2>&1; rm -rf /tmp/dbrestore_${restoreId} ${remotePath}`;
    } else if (restoreType === 'database-postgres') {
      command = `mkdir -p /tmp/dbrestore_${restoreId} && tar -xzf ${remotePath} -C /tmp/dbrestore_${restoreId} && pg_restore -d postgres /tmp/dbrestore_${restoreId}/dump.dump 2>&1; rm -rf /tmp/dbrestore_${restoreId} ${remotePath}`;
    } else {
      command = `mkdir -p ${restorePath} && tar -xzf ${remotePath} -C ${restorePath} 2>&1; rm -f ${remotePath}`;
    }

    const result = await execCommand(sshConfig, command);

    return NextResponse.json({
      success: result.code === 0,
      logs: (result.stdout + result.stderr).trim(),
      exitCode: result.code,
    });
  } catch (error) {
    console.error('[server-backup/restore] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (tempFile) { try { await unlink(tempFile); } catch {} }
  }
}
