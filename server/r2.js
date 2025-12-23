import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'yanplanner';

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.warn('[R2] Missing credentials - file storage will not work');
}

const r2Client = R2_ACCOUNT_ID
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      }
    })
  : null;

/**
 * Upload a file to R2 storage
 * @param {Buffer} buffer - File buffer
 * @param {string} key - File key/path in bucket
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Public URL or key
 */
export const uploadToR2 = async (buffer, key, contentType) => {
  if (!r2Client) {
    throw new Error('R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env');
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType
  });

  await r2Client.send(command);
  
  // Return the key - we'll generate signed URLs when needed
  return key;
};

/**
 * Generate a presigned upload URL for direct browser uploads
 * @param {string} key - File key/path in bucket
 * @param {string} contentType - MIME type
 * @param {number} expiresIn - URL expiry in seconds (default 5 minutes)
 * @returns {Promise<string>} Presigned upload URL
 */
export const getPresignedUploadUrl = async (key, contentType, expiresIn = 300) => {
  if (!r2Client) {
    throw new Error('R2 not configured');
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType
  });

  return await getSignedUrl(r2Client, command, { expiresIn });
};

/**
 * Generate a signed URL to access a file
 * @param {string} key - File key in bucket
 * @param {number} expiresIn - URL expiry in seconds (default 1 hour)
 * @returns {Promise<string>} Signed URL
 */
export const getSignedDownloadUrl = async (key, expiresIn = 3600) => {
  if (!r2Client) {
    throw new Error('R2 not configured');
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key
  });

  return await getSignedUrl(r2Client, command, { expiresIn });
};

/**
 * Download file from R2 as buffer
 * @param {string} key - File key in bucket
 * @returns {Promise<Buffer>} File buffer
 */
export const downloadFromR2 = async (key) => {
  if (!r2Client) {
    throw new Error('R2 not configured');
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key
  });

  const response = await r2Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Delete file from R2
 * @param {string} key - File key in bucket
 * @returns {Promise<void>}
 */
export const deleteFromR2 = async (key) => {
  if (!r2Client) {
    console.warn('[R2] Cannot delete - R2 not configured');
    return;
  }

  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key
  });

  await r2Client.send(command);
  console.log('[R2] Deleted file:', key);
};

/**
 * Delete multiple files from R2
 * @param {string[]} keys - Array of file keys
 * @returns {Promise<void>}
 */
export const deleteMultipleFromR2 = async (keys) => {
  if (!keys || keys.length === 0) return;
  
  await Promise.all(keys.map(key => deleteFromR2(key).catch(err => {
    console.error('[R2] Failed to delete', key, ':', err.message);
  })));
  
  console.log('[R2] Deleted', keys.length, 'files');
};
