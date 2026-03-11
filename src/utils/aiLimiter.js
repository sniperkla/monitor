import connectDB from '@/lib/mongodb';
import { AiUsageRepository } from '@/lib/repositories/AiUsageRepository';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';

const UTC_PLUS_7_OFFSET_MS = 7 * 60 * 60 * 1000;

function getDayKeyUTC7(date = new Date()) {
  const shifted = new Date(date.getTime() + UTC_PLUS_7_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

async function getGlobalDailyLimit(db) {
  try {
    const repo = new SystemSettingRepository(db);
    await repo.init();
    const doc = await repo.findOne({ key: 'ai_limits' });
    const legacyDoc = doc ? null : await repo.findOne({ key: 'ai_usage_global' });

    const chosen = doc || legacyDoc;
    const value = chosen?.value && typeof chosen.value === 'object' ? chosen.value : {};
    const limit = Number(value.dailyLimit);
    if (Number.isFinite(limit) && limit > 0) return limit;
    const envLimit = Number(process.env.AI_DAILY_LIMIT);
    return Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 10000;
  } catch {
    const envLimit = Number(process.env.AI_DAILY_LIMIT);
    return Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 10000;
  }
}

async function getOrCreateUsage(email, db) {
  const todayKey = getDayKeyUTC7();
  const repo = new AiUsageRepository(db);
  await repo.init();
  let usage = await repo.findOne({ email });

  if (!usage) {
    usage = await repo.create({ email, dayKey: todayKey, tokensUsed: 0 });
  } else if (usage.dayKey !== todayKey) {
    usage.dayKey = todayKey;
    usage.tokensUsed = 0;
    usage.lastUpdated = new Date();
    await repo.updateOne({ email }, { $set: { dayKey: todayKey, lastUpdated: new Date() } });
  }

  return usage;
}

export async function checkAndTrackAiUsage(email, roughPrompt, roughResponse = '', roughContext = '') {
  const db = await connectDB(process.env.MONGODB_URI, true);

  if (!email) {
    throw new Error('AI usage tracking requires a user email.');
  }

  const dailyLimit = await getGlobalDailyLimit(db);
  const usage = await getOrCreateUsage(email, db);

  if (usage.tokensUsed >= dailyLimit) {
    throw new Error(
      `Daily AI limit reached (${usage.tokensUsed}/${dailyLimit} tokens used). Resets at midnight UTC+7.`
    );
  }

  const estimatedPromptTokens = Math.ceil((roughPrompt.length + roughContext.length) / 3.5);
  const estimatedResponseTokens = roughResponse
    ? Math.ceil(roughResponse.length / 3.5)
    : 300;

  if (usage.tokensUsed + estimatedPromptTokens >= dailyLimit) {
    throw new Error(
      `Daily AI limit reached (${usage.tokensUsed}/${dailyLimit} tokens used). Resets at midnight UTC+7.`
    );
  }

  if (roughResponse) {
    const tokensConsumed = estimatedPromptTokens + estimatedResponseTokens;
    const repo = new AiUsageRepository(db);
    await repo.updateOne(
      { email },
      {
        $inc: { tokensUsed: tokensConsumed },
        $set: { lastUpdated: new Date() },
      }
    );
    usage.tokensUsed += tokensConsumed;
  }

  return {
    allowed: true,
    used: usage.tokensUsed,
    limit: dailyLimit,
    remaining: Math.max(0, dailyLimit - usage.tokensUsed),
  };
}

export async function getAiUsage(email) {
  const db = await connectDB(process.env.MONGODB_URI, true);
  const dailyLimit = await getGlobalDailyLimit(db);

  if (!email) {
    return { used: 0, limit: dailyLimit };
  }

  const todayKey = getDayKeyUTC7();
  const repo = new AiUsageRepository(db);
  await repo.init();
  const usage = await repo.findOne({ email });

  if (!usage || usage.dayKey !== todayKey) {
    return { used: 0, limit: dailyLimit };
  }

  return {
    used: usage.tokensUsed || 0,
    limit: dailyLimit,
  };
}
