import { getUserState, saveUserState } from '../server/state.js';
import { readJson, sendJson } from './_lib/http.js';
import { logRequest } from './_lib/log.js';

const getUserId = (req) => {
  const url = new URL(req.url || '', 'http://localhost');
  return url.searchParams.get('userId');
};

export default async function handler(req, res) {
  logRequest(req, res);
  try {
    if (req.method === 'GET') {
      const userId = getUserId(req);
      if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
      const state = await getUserState(userId);
      return sendJson(res, 200, state);
    }
    if (req.method === 'POST') {
      const { userId, tasks, chat, config, selectedTaskId } = await readJson(req);
      if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
      const state = await saveUserState(userId, { tasks, chat, config, selectedTaskId });
      return sendJson(res, 200, state);
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'State error' });
  }
}
