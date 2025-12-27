import { getUserState, saveUserState } from '../server/state.js';
import { deleteMultipleFromR2 } from '../server/r2.js';
import { readJson, sendJson } from './_lib/http.js';
import { logRequest } from './_lib/log.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

const getUserId = (req) => {
  const url = new URL(req.url || '', 'http://localhost');
  return url.searchParams.get('userId');
};

export default async function handler(req, res) {
  logRequest(req, res);
  try {
    // GET /api/state?version - get server version
    const url = new URL(req.url || '', 'http://localhost');
    if (req.method === 'GET' && url.searchParams.has('version')) {
      return sendJson(res, 200, { version });
    }
    
    if (req.method === 'GET') {
      const userId = getUserId(req);
      if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
      const state = await getUserState(userId);
      return sendJson(res, 200, state);
    }
    if (req.method === 'POST') {
      const { userId, tasks, chat, trash, config, selectedTaskId } = await readJson(req);
      if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
      const state = await saveUserState(userId, { tasks, chat, trash, config, selectedTaskId });
      return sendJson(res, 200, state);
    }
    if (req.method === 'DELETE') {
      // Delete R2 files (combined from old /api/delete-files)
      const { keys } = await readJson(req);
      if (!keys || !Array.isArray(keys)) {
        return sendJson(res, 400, { error: 'Missing or invalid keys array' });
      }
      if (keys.length === 0) {
        return sendJson(res, 200, { deleted: 0 });
      }
      console.log('[state/delete] Deleting', keys.length, 'files from R2');
      await deleteMultipleFromR2(keys);
      return sendJson(res, 200, { deleted: keys.length });
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'State error' });
  }
}