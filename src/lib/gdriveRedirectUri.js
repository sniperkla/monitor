/**
 * Resolve the Google Drive OAuth redirect URI for MongoSync, exactly the way
 * /api/mongo-sync/gdrive/auth does when starting the flow.
 *
 * Order: GDRIVE_REDIRECT_URI env → NEXTAUTH_URL (unless localhost) →
 * forwarded/host headers → request origin. Always ends with
 * /api/mongo-sync/gdrive/callback.
 *
 * Used by the auth route (to start the flow) and the status route (so the
 * settings UI can show the user exactly which URI to register in Google
 * Cloud Console → Credentials → Authorized redirect URIs).
 */
export function resolveGdriveRedirectUri(request) {
  let redirectUri = process.env.GDRIVE_REDIRECT_URI;
  if (!redirectUri) {
    let origin = process.env.NEXTAUTH_URL;
    if (!origin || origin.includes('localhost')) {
      const forwardedProto = request.headers.get('x-forwarded-proto');
      const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
      if (forwardedHost) {
        const proto = forwardedProto || (forwardedHost.includes('localhost') ? 'http' : 'https');
        origin = `${proto}://${forwardedHost}`;
      } else {
        origin = request.nextUrl?.origin || 'http://localhost:3000';
      }
    }
    redirectUri = `${origin.replace(/\/$/, '')}/api/mongo-sync/gdrive/callback`;
  }
  return redirectUri;
}
