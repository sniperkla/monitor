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
 * Deployment project id charset.
 *
 * A project id is interpolated into a SystemSetting key
 * (`auto_deploy_config_<id>`), so it must be constrained to a safe charset.
 * Without this, a caller could mint arbitrary keys — and on the OAuth callback
 * path, where the write is attributed to a user recovered from a state record,
 * an unvalidated id is one more attacker-influenced value reaching a DB key.
 */
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate a deployment project id.
 *
 * Contract:
 *   - undefined / null / ''  -> 'default'. This is what `?project=` produces,
 *     and the routes used to resolve it via `|| 'default'`; keep that.
 *   - a valid id             -> the trimmed id
 *   - anything else          -> null, for the caller to reject explicitly
 *
 * Whitespace-only input is NOT treated as absent: it is a value that fails the
 * charset, and the old `|| 'default'` handling would have interpolated it
 * straight into a settings key.
 *
 * @param {*} value
 * @returns {string|null} the safe project id, or null if invalid
 */
export function validateProjectId(value) {
  if (value === undefined || value === null || value === '') return 'default';
  const projectId = String(value).trim();
  return PROJECT_ID_PATTERN.test(projectId) ? projectId : null;
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
