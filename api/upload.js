import { uploadToR2 } from '../server/r2.js';
import { sendJson, readJson } from './_lib/http.js';
import { logRequest } from './_lib/log.js';
import { prisma } from '../server/prisma.js';

export default async function handler(req, res) {
  logRequest(req, res);
  
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    console.log('[upload] Parsing request body...');
    const { fileName, fileData, contentType, userId } = await readJson(req);
    
    console.log('[upload] Received:', { fileName, contentType, userId, dataSize: fileData?.length });
    
    if (!userId) {
      console.error('[upload] Missing userId');
      return sendJson(res, 400, { error: 'Missing userId' });
    }
    
    // Check balance (server-side enforcement)
    console.log('[upload] Checking user balance...');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      console.error('[upload] User not found');
      return sendJson(res, 404, { error: 'User not found' });
    }
    const balanceCents = user.balanceCents || 0;
    console.log('[upload] User balance:', balanceCents, 'cents');
    if (balanceCents < 50) {
      console.error('[upload] Insufficient balance');
      return sendJson(res, 402, { error: 'Insufficient balance. Minimum $0.50 required for file uploads.' });
    }
    
    if (!fileName || !fileData || !contentType) {
      console.error('[upload] Missing required fields');
      return sendJson(res, 400, { error: 'Missing fileName, fileData, or contentType' });
    }

    // Extract base64 data (remove data URL prefix if present)
    console.log('[upload] Converting base64 to buffer...');
    const base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('[upload] Buffer size:', buffer.length, 'bytes');

    // Generate unique key: userId/timestamp-filename
    const timestamp = Date.now();
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${userId}/${timestamp}-${sanitizedName}`;
    console.log('[upload] Uploading to R2 with key:', key);

    // Upload to R2
    const r2Key = await uploadToR2(buffer, key, contentType);
    console.log('[upload] ✅ R2 UPLOAD SUCCESSFUL');
    console.log('[upload] R2 Key:', r2Key);
    console.log('[upload] File stored in Cloudflare R2 bucket:', process.env.R2_BUCKET_NAME || 'yanplanner');

    return sendJson(res, 200, { 
      key: r2Key,
      fileName,
      contentType,
      size: buffer.length
    });
  } catch (err) {
    console.error('[upload] Error:', err);
    console.error('[upload] Stack:', err.stack);
    return sendJson(res, 500, { error: err.message || 'Upload failed' });
  }
}
