import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // RBAC: Check for admin access
    const adminEmail = process.env.ADMIN_EMAIL;
    if (session.user.role !== 'admin' && (!adminEmail || session.user.email !== adminEmail)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Ensure DB connection
    await connectDB();

    const scriptPath = path.join(process.cwd(), 'scripts', 'grok.txt');
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ success: false, error: 'scripts/grok.txt not found' }, { status: 404 });
    }

    const content = fs.readFileSync(scriptPath, 'utf-8');
    const existingKeys = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 10 && !line.startsWith('#')); // Basic validation

    if (existingKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid keys found in grok.txt' }, { status: 400 });
    }

    // Find current setting to preserve index if possible, or reset if forcing update
    let setting = await SystemSetting.findOne({ key: 'ai_api_keys' });
    
    if (!setting) {
      setting = new SystemSetting({
        key: 'ai_api_keys',
        value: {
          keys: existingKeys,
          currentIndex: 0,
          provider: 'groq'
        }
      });
    } else {
      // Update keys but keep index valid
      setting.value.keys = existingKeys;
      if (setting.value.currentIndex >= existingKeys.length) {
        setting.value.currentIndex = 0;
      }
      // Trigger update for mixed type
      setting.markModified('value');
    }

    await setting.save();

    return NextResponse.json({ 
      success: true, 
      message: `Seeded ${existingKeys.length} keys`, 
      keys: existingKeys.map(k => k.substring(0, 8) + '...') 
    });
  } catch (err) {
    logger.error('Error seeding keys:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
