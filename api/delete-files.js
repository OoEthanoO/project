import { deleteMultipleFromR2 } from '../server/r2.js';
import { sendJson, readJson } from './_lib/http.js';
import { logRequest } from './_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { keys } = await readJson(req);
    
    if (!keys || !Array.isArray(keys)) {
      return sendJson(res, 400, { error: 'Missing or invalid keys array' });
    }

    if (keys.length === 0) {
      return sendJson(res, 200, { deleted: 0 });
    }

    console.log('[delete-files] Deleting', keys.length, 'files from R2');
    await deleteMultipleFromR2(keys);

    return sendJson(res, 200, { deleted: keys.length });
  } catch (err) {
    console.error('[delete-files] Error:', err);
    return sendJson(res, 500, { error: err.message || 'Delete failed' });
  }
}
