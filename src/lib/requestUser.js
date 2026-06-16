/**
 * Attach authenticated user id to a connection payload for relay routing.
 */
export async function attachRequestUserId(request, conn) {
  if (!conn || conn._userId) return conn;
  try {
    const { getToken } = await import('next-auth/jwt');
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (token?.sub) return { ...conn, _userId: token.sub };
  } catch (_) {}
  return conn;
}

export function isRelayConnectionError(message) {
  const msg = String(message || '');
  return /local relay agent is not connected/i.test(msg)
    || /connection .* to 127\.0\.0\.1:\d+ closed/i.test(msg)
    || /ECONNREFUSED.*127\.0\.0\.1/i.test(msg);
}

export function friendlyRelayErrorMessage(message) {
  const msg = String(message || '');
  if (/connection .* to 127\.0\.0\.1:\d+ closed/i.test(msg)) {
    return 'Relay tunnel closed unexpectedly. Ensure local-relay.js is running, MongoDB/MySQL is up locally, then click Retry.';
  }
  if (/local relay agent is not connected/i.test(msg)) {
    return msg;
  }
  return msg;
}
