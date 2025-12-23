import { getPresignedUploadUrl } from '../server/r2.js';
import { sendJson, readJson } from './_lib/http.js';
import { logRequest } from './_lib/log.js';
import { prisma } from '../server/prisma.js';

export default async function handler(req, res) {
  logRequest(req, res);
  
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { fileName, contentType, userId } = await readJson(req);
    
    if (!userId) {
      return sendJson(res, 400, { error: 'Missing userId' });
    }
    
    if (!fileName || !contentType) {
      return sendJson(res, 400, { error: 'Missing fileName or contentType' });
    }

    // Check balance (server-side enforcement)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return sendJson(res, 404, { error: 'User not found' });
    }
    const balanceCents = user.balanceCents || 0;
    if (balanceCents < 50) {
      return sendJson(res, 402, { error: 'Insufficient balance. Minimum $0.50 required for file uploads.' });
    }

    // Generate unique key: userId/timestamp-filename
    const timestamp = Date.now();
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${userId}/${timestamp}-${sanitizedName}`;

    // Generate presigned URL for direct upload
    const uploadUrl = await getPresignedUploadUrl(key, contentType);

    console.log('[upload-url] Generated presigned URL for:', key);

    return sendJson(res, 200, { 
      uploadUrl,
      key,
      fileName,
      contentType
    });
  } catch (err) {
    console.error('[upload-url] Error:', err);
    return sendJson(res, 500, { error: err.message || 'Failed to generate upload URL' });
  }
}
