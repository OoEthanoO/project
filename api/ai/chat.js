import { chatWithPlanner } from '../../server/ai.js';
import { sendJson, readJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { prompt, tasks, globalInstruction, selectedTaskId, modelId, userId } = await readJson(req);
    if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
    const result = await chatWithPlanner({ prompt, tasks, globalInstruction, selectedTaskId, modelId });
    return sendJson(res, 200, { content: result.content });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Unknown error' });
  }
}
