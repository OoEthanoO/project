import { generateSubtasks } from '../../server/ai.js';
import { sendJson, readJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { task, conversation, globalInstruction, modelId, userId } = await readJson(req);
    if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
    const result = await generateSubtasks({ task, conversation, globalInstruction, modelId });
    return sendJson(res, 200, { items: result.items });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Unknown error' });
  }
}
