import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
// R2_PUBLIC_DOMAIN is intentionally not used for backup downloads. Keeping
// this module free of a public fallback prevents accidental bearer URLs.

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY environment variables.');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export async function uploadStreamToR2(key, readableStream, contentType = 'application/gzip') {
  const client = getClient();
  const upload = new Upload({
    client,
    params: {
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: readableStream,
      ContentType: contentType,
    },
    queueSize: 4,
    partSize: 10 * 1024 * 1024, // 10MB parts
  });

  await upload.done();
  return { key, bucket: R2_BUCKET_NAME };
}

export async function getPresignedUrl(key, expiresIn = 3600) {
  const client = getClient();

  // Never convert an object key into a public bearer URL. Even when
  // R2_PUBLIC_DOMAIN is configured for unrelated assets, backups must remain
  // private and be served through an authenticated application route.
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function r2ObjectExists(key) {
  const client = getClient();
  try {
    await client.send(new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

export function isR2Configured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}
