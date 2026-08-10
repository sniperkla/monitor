import connectDB from './mongodb.js';
import { SystemSettingRepository } from './repositories/SystemSettingRepository.js';
import { withRetry } from './mongoSyncUtils.js';

const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024; // 5MB — Google's limit for simple upload

export async function getGoogleDriveConfig(userId = null) {
  const db = await connectDB();
  const settingRepo = new SystemSettingRepository(db, userId || 'global');
  await settingRepo.init();
  const configSetting = await settingRepo.findOne({ key: 'google_drive_config' });
  return configSetting ? configSetting.value : null;
}

export async function saveGoogleDriveConfig(config, userId = null) {
  const db = await connectDB();
  const settingRepo = new SystemSettingRepository(db, userId || 'global');
  await settingRepo.init();
  await settingRepo.upsert('google_drive_config', config);
}

export async function getGoogleAccessToken(userId = null) {
  const config = await getGoogleDriveConfig(userId);
  if (!config || !config.refreshToken) {
    throw new Error('Google Drive integration is not connected.');
  }

  // Check if token is still valid (with 5-minute safety buffer)
  if (config.accessToken && config.expiresAt && config.expiresAt - 5 * 60 * 1000 > Date.now()) {
    return config.accessToken;
  }

  // Expired: refresh token
  const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (Client ID/Secret) are missing.');
  }

  console.log('🔄 Refreshing Google Drive Access Token...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (data.error) {
    console.error('❌ Failed to refresh Google token:', data);
    throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  }

  const updatedConfig = {
    ...config,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };

  await saveGoogleDriveConfig(updatedConfig, userId);
  return data.access_token;
}

export async function listGoogleDriveFolders(parentId = null, userId = null) {
  return withRetry(async () => {
    const accessToken = await getGoogleAccessToken(userId);

    // Always require explicit parent — if null, use 'root'
    const actualParentId = parentId || 'root';
    const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${actualParentId}' in parents`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.files || [];
  }, { label: 'listGoogleDriveFolders' });
}

export async function createGoogleDriveFolder(folderName, userId = null) {
  return withRetry(async () => {
    const accessToken = await getGoogleAccessToken(userId);
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }, { label: 'createGoogleDriveFolder' });
}

export async function ensureDriveFolder(parentId, folderName, userId = null) {
  return withRetry(async () => {
    const accessToken = await getGoogleAccessToken(userId);
    // Search for existing folder with this name under the parent
    const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    if (data.files && data.files.length > 0) return data.files[0];

    // Not found — create it with parent
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });

    const created = await createRes.json();
    if (created.error) throw new Error(created.error.message);
    return created;
  }, { label: 'ensureDriveFolder' });
}

export async function uploadFileToGoogleDrive({ fileName, content, folderId, userId = null }) {
  const accessToken = await getGoogleAccessToken(userId);
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const bodyBytes = Buffer.byteLength(body, 'utf8');

  const metadata = {
    name: fileName,
    ...(folderId ? { parents: [folderId] } : {})
  };

  if (bodyBytes <= SIMPLE_UPLOAD_LIMIT) {
    // Simple multipart upload for small files
    const boundary = 'antigravity_multipart_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      body +
      closeDelimiter;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }

  // Resumable upload for large files
  const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/json',
      'X-Upload-Content-Length': String(bodyBytes),
    },
    body: JSON.stringify(metadata),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Resumable upload init failed: ${initRes.status} ${errText}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('Resumable upload: no Location header returned');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(bodyBytes),
    },
    body,
  });

  const data = await uploadRes.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function listDriveFiles(folderId, userId = null) {
  return withRetry(async () => {
    const accessToken = await getGoogleAccessToken(userId);
    // Don't filter by mimeType — Google Drive may store JSON as application/octet-stream
    // or other types depending on how they were uploaded. Filter by name instead.
    const query = `'${folderId}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime,mimeType)`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    // Include JSON files regardless of mimeType, and also include any backup archives
    const files = (data.files || []).filter(f =>
      f.name.endsWith('.json') ||
      f.name.endsWith('.gz') ||
      f.name.endsWith('.tar.gz') ||
      f.mimeType === 'application/json' ||
      f.mimeType === 'application/octet-stream'
    );
    return files;
  }, { label: 'listDriveFiles' });
}

export async function downloadDriveFile(fileId, userId = null) {
  return withRetry(async () => {
    const accessToken = await getGoogleAccessToken(userId);
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) throw new Error(`Failed to download file: ${res.statusText}`);
    return await res.json();
  }, { label: 'downloadDriveFile' });
}
