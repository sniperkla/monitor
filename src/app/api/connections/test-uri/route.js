import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { checkRateLimit } from '@/lib/serverGuard';

/**
 * POST - Test a raw database URI connection
 * Used by MasterPasswordModal and SettingsApp for vault setup
 */
export async function POST(request) {
  try {
    // Rate limiting
    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`test-uri:${clientIP}`, 20);
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, 
        error: `Too many connection tests. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    const body = await request.json();
    const { uri } = body;

    if (!uri || typeof uri !== 'string') {
      return NextResponse.json({ 
        success: false, 
        error: 'Database URI is required' 
      }, { status: 400 });
    }

    // Validate protocol
    const allowed = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const isValid = allowed.some(p => uri.startsWith(p));
    
    if (!isValid) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unsupported database protocol. Must be MongoDB, MySQL, or PostgreSQL' 
      }, { status: 400 });
    }

    // Test connection based on protocol
    if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
      return await testMongoConnection(uri);
    } else if (uri.startsWith('mysql://')) {
      return await testMySQLConnection(uri);
    } else if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
      return await testPostgresConnection(uri);
    }

    return NextResponse.json({ 
      success: false, 
      error: 'Unsupported protocol' 
    }, { status: 400 });

  } catch (error) {
    console.error('Test URI Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Connection test failed' 
    }, { status: 500 });
  }
}

async function testMongoConnection(uri) {
  let conn = null;
  try {
    conn = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    }).asPromise();

    // Try to get server info
    let version = 'Connected';
    try {
      const admin = conn.db.admin();
      const status = await admin.serverStatus();
      version = `MongoDB ${status.version}`;
    } catch (e) {
      // Some MongoDB instances don't allow admin commands
      version = 'MongoDB (Connected)';
    }

    await conn.close();
    return NextResponse.json({ 
      success: true, 
      message: `Successfully connected to ${version}`,
      info: version
    });

  } catch (error) {
    if (conn) {
      try { await conn.close(); } catch (e) {}
    }
    
    // Provide helpful error messages
    let errorMessage = error.message;
    if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้ โปรดตรวจสอบ URI และตรวจสอบว่า MongoDB กำลังทำงานอยู่';
    } else if (error.message.includes('authentication failed')) {
      errorMessage = 'การยืนยันตัวตนล้มเหลว ตรวจสอบชื่อผู้ใช้และรหัสผ่าน';
    } else if (error.message.includes('ETIMEDOUT')) {
      errorMessage = 'การเชื่อมต่อหมดเวลา ตรวจสอบที่อยู่โฮสต์และพอร์ต';
    }

    return NextResponse.json({ 
      success: false, 
      error: errorMessage
    }, { status: 400 });
  }
}

async function testMySQLConnection(uri) {
  let connection = null;
  try {
    connection = await mysql.createConnection(uri);
    const [rows] = await connection.query('SELECT VERSION() as version');
    await connection.end();
    
    return NextResponse.json({ 
      success: true, 
      message: `Successfully connected to MySQL ${rows[0].version}`,
      info: `MySQL ${rows[0].version}`
    });

  } catch (error) {
    if (connection) {
      try { await connection.end(); } catch (e) {}
    }

    let errorMessage = error.message;
    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้ โปรดตรวจสอบ URI และตรวจสอบว่า MySQL กำลังทำงานอยู่';
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      errorMessage = 'การยืนยันตัวตนล้มเหลว ตรวจสอบชื่อผู้ใช้และรหัสผ่าน';
    }

    return NextResponse.json({ 
      success: false, 
      error: errorMessage
    }, { status: 400 });
  }
}

async function testPostgresConnection(uri) {
  // Note: PostgreSQL support would require pg package
  return NextResponse.json({ 
    success: false, 
    error: 'PostgreSQL testing not yet implemented. Please install pg package.' 
  }, { status: 501 });
}
