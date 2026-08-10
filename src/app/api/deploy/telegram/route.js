import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { decrypt, decryptWithMetadata } from '@/utils/encryption';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';

function resolveBotToken(tokenInput, savedToken) {
  if (tokenInput && tokenInput.trim()) {
    const raw = tokenInput.trim();
    // Try decrypting if it was sent encrypted or has colon format
    const test = decryptWithMetadata(raw);
    if (test.success && test.text) return test.text;
    return raw;
  }
  if (savedToken) {
    const test = decryptWithMetadata(savedToken);
    if (test.success && test.text) return test.text;
    return savedToken;
  }
  return null;
}

// GET /api/deploy/telegram?project=id&botToken=...
// Fetches Telegram Bot info & recent chat IDs from getUpdates
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project') || 'default';
    const providedToken = searchParams.get('botToken');

    await connectDB(process.env.MONGODB_URI, true);
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
    const userIdQuery = resolveUserIdQuery(userId);
    const setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    const savedConfig = setting?.value || {};

    const botToken = resolveBotToken(providedToken, savedConfig.telegramBotToken);

    if (!botToken) {
      return NextResponse.json({ success: false, error: 'Telegram Bot Token is required' }, { status: 400 });
    }

    // 1. Get Bot info (getMe)
    const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const getMeData = await getMeRes.json();

    if (!getMeData.ok) {
      return NextResponse.json({
        success: false,
        error: getMeData.description || 'Invalid Telegram Bot Token'
      }, { status: 400 });
    }

    const botInfo = getMeData.result;

    // 2. Fetch updates to find chats
    const updatesRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100&allowed_updates=["message","edited_message","channel_post","my_chat_member","chat_member"]`);
    const updatesData = await updatesRes.json();

    if (!updatesData.ok) {
      return NextResponse.json({
        success: false,
        error: updatesData.description || 'Failed to fetch updates from Telegram'
      }, { status: 400 });
    }

    const chatMap = new Map();

    (updatesData.result || []).forEach(item => {
      const chat = item.message?.chat ||
                 item.edited_message?.chat ||
                 item.channel_post?.chat ||
                 item.my_chat_member?.chat ||
                 item.chat_member?.chat;

      if (chat && chat.id) {
        const idStr = String(chat.id);
        if (!chatMap.has(idStr)) {
          let title = chat.title;
          if (!title) {
            const nameParts = [chat.first_name, chat.last_name].filter(Boolean);
            title = nameParts.length > 0 ? nameParts.join(' ') : (chat.username ? `@${chat.username}` : idStr);
          }
          chatMap.set(idStr, {
            id: idStr,
            title: title,
            type: chat.type || 'private',
            username: chat.username ? `@${chat.username}` : null
          });
        }
      }
    });

    const chats = Array.from(chatMap.values());

    return NextResponse.json({
      success: true,
      bot: {
        id: botInfo.id,
        username: botInfo.username,
        first_name: botInfo.first_name
      },
      chats
    });
  } catch (err) {
    console.error('Error fetching Telegram chats:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/deploy/telegram
// Sends a test notification to Telegram chat
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const body = await request.json();
    const { projectId = 'default', botToken: providedToken, chatId } = body;

    const chatIds = String(chatId || '')
      .split(/[\s,]+/)
      .map(id => id.trim())
      .filter(Boolean);

    if (chatIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Telegram Chat ID is required' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
    const userIdQuery = resolveUserIdQuery(userId);
    const setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    const savedConfig = setting?.value || {};

    const botToken = resolveBotToken(providedToken, savedConfig.telegramBotToken);

    if (!botToken) {
      return NextResponse.json({ success: false, error: 'Telegram Bot Token is required' }, { status: 400 });
    }

    const projectName = savedConfig.name || projectId;

    const testText = `🧪 <b>Test Notification</b>\n\n` +
      `<b>Project:</b> ${projectName}\n` +
      `<b>Status:</b> Telegram alerts are configured & working properly! 🎉\n` +
      `<b>Time:</b> <code>${new Date().toISOString()}</code>`;

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const results = await Promise.allSettled(
      chatIds.map(async (cid) => {
        const res = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cid,
            text: testText,
            parse_mode: 'HTML'
          })
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(`Chat ${cid}: ${data.description || 'Failed'}`);
        }
        return cid;
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');

    if (succeeded === 0 && failed.length > 0) {
      return NextResponse.json({
        success: false,
        error: failed[0].reason?.message || 'Failed to send test notification'
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Test notification sent to ${succeeded} chat(s)!${failed.length > 0 ? ` (${failed.length} failed)` : ''}`
    });
  } catch (err) {
    console.error('Error sending test Telegram notification:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
