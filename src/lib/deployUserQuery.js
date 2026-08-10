import mongoose from 'mongoose';

/**
 * Resolves a userId into a MongoDB query filter that matches both
 * string-stored and ObjectId-stored userId values.
 *
 * Problem: SystemSetting.userId may be stored as String or ObjectId.
 * This helper builds an $in query that covers both forms.
 *
 * @param {string|object} userId - User ID (from session.user.id)
 * @returns {object} MongoDB query fragment: { userId: <filter> }
 */
export function resolveUserIdQuery(userId) {
  if (!userId) {
    throw new Error('userId is required - no global fallback allowed');
  }

  const candidates = [];
  const userIdStr = String(userId);

  // Always include the string form
  candidates.push(userIdStr);

  // If it looks like a valid ObjectId, also include the ObjectId form
  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    try {
      candidates.push(new mongoose.Types.ObjectId(userIdStr));
    } catch (e) {
      // Not a valid ObjectId — string-only is fine
    }
  }

  if (candidates.length === 1) {
    return { userId: candidates[0] };
  }

  return { userId: { $in: candidates } };
}

/**
 * Normalizes a userId to ObjectId if valid.
 * Use this when writing (upsert/update) to ensure consistent storage as ObjectId.
 *
 * @param {string|object} userId
 * @returns {ObjectId}
 */
export function normalizeUserId(userId) {
  if (!userId) {
    throw new Error('userId is required - no global fallback allowed');
  }
  
  const userIdStr = String(userId);
  
  // Convert to ObjectId if it's a valid ObjectId string
  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    try {
      return new mongoose.Types.ObjectId(userIdStr);
    } catch (e) {
      throw new Error(`Invalid ObjectId format: ${userIdStr}`);
    }
  }
  
  throw new Error(`userId must be a valid ObjectId: ${userIdStr}`);
}
