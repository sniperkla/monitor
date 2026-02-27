import connectDB from '@/lib/mongodb';
import AiUsage from '@/models/AiUsage';
import SystemSetting from '@/models/SystemSetting';

/**
 * AI Token Limiter Utility
 * 
 * - Each user gets a separate AiUsage document in the central DB (by email).
 * - The global daily limit is stored in SystemSetting (key: 'ai_limits', value.dailyLimit).
 *   Default: 10,000 tokens/user/day.
 * - Resets every day at midnight UTC+7 (Bangkok timezone).
 * - Token estimation: ~1 token per 3.5 characters.
 */

const UTC_PLUS_7_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Get the "day key" in UTC+7 — e.g. "2026-02-18"
 */
function getDayKeyUTC7(date = new Date()) {
  const shifted = new Date(date.getTime() + UTC_PLUS_7_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Read the global daily limit from SystemSetting.
 * Falls back to 10,000 if not configured.
 */
async function getGlobalDailyLimit() {
  try {
    // Prefer the newer key: 'ai_limits'
    const doc = await SystemSetting.findOne({ key: 'ai_limits' });
    // Backward/alternate support: some deployments used 'ai_usage_global'
    const legacyDoc = doc ? null : await SystemSetting.findOne({ key: 'ai_usage_global' });

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

/**
 * Get or create the AiUsage document for a user.
 * Automatically resets if the UTC+7 day has changed.
 */
async function getOrCreateUsage(email) {
  const todayKey = getDayKeyUTC7();
  let usage = await AiUsage.findOne({ email });

  if (!usage) {
    // First time — create a fresh record
    usage = await AiUsage.create({ email, dayKey: todayKey, tokensUsed: 0 });
  } else if (usage.dayKey !== todayKey) {
    // New day in UTC+7 — reset tokens
    usage.dayKey = todayKey;
    usage.tokensUsed = 0;
    usage.lastUpdated = new Date();
    await usage.save();
  }

  return usage;
}

/**
 * Check if the user can use AI, and optionally record token usage.
 * 
 * Call pattern in routes:
 *   1) Pre-check:  await checkAndTrackAiUsage(email, prompt, '', context) — checks limit, throws if exceeded
 *   2) Post-track: await checkAndTrackAiUsage(email, prompt, answer)     — records actual usage
 * 
 * @param {string} email - User email
 * @param {string} roughPrompt - The prompt text
 * @param {string} roughResponse - The AI response text (empty = pre-check only)
 * @param {string} roughContext - Extra context text sent to AI (terminal output, schema, etc.)
 * @returns {{ allowed: boolean, used: number, limit: number, remaining: number }}
 */
export async function checkAndTrackAiUsage(email, roughPrompt, roughResponse = '', roughContext = '') {
  await connectDB(process.env.MONGODB_URI, true);

  if (!email) {
    throw new Error('AI usage tracking requires a user email.');
  }

  const dailyLimit = await getGlobalDailyLimit();
  const usage = await getOrCreateUsage(email);

  // Hard block: user is already at or over limit — don't even estimate
  if (usage.tokensUsed >= dailyLimit) {
    throw new Error(
      `Daily AI limit reached (${usage.tokensUsed}/${dailyLimit} tokens used). Resets at midnight UTC+7.`
    );
  }

  const estimatedPromptTokens = Math.ceil((roughPrompt.length + roughContext.length) / 3.5);
  const estimatedResponseTokens = roughResponse
    ? Math.ceil(roughResponse.length / 3.5)
    : 300; // Conservative future-response estimate for pre-check

  // Pre-check: would this prompt + context + estimated response exceed limit?
  if (usage.tokensUsed + estimatedPromptTokens >= dailyLimit) {
    throw new Error(
      `Daily AI limit reached (${usage.tokensUsed}/${dailyLimit} tokens used). Resets at midnight UTC+7.`
    );
  }

  // Post-track: record actual token usage (only when we have a response)
  if (roughResponse) {
    const tokensConsumed = estimatedPromptTokens + estimatedResponseTokens;
    await AiUsage.updateOne(
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

/**
 * Get current AI usage for a user (read-only, for UI display).
 */
export async function getAiUsage(email) {
  await connectDB(process.env.MONGODB_URI, true);

  const dailyLimit = await getGlobalDailyLimit();

  if (!email) {
    return { used: 0, limit: dailyLimit };
  }

  const todayKey = getDayKeyUTC7();
  const usage = await AiUsage.findOne({ email });

  // No record or different day = 0 usage
  if (!usage || usage.dayKey !== todayKey) {
    return { used: 0, limit: dailyLimit };
  }

  return {
    used: usage.tokensUsed || 0,
    limit: dailyLimit,
  };
}
