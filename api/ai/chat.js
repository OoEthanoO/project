import { chatWithPlanner } from '../../server/ai.js';
import { getBalance, chargeUsage } from '../../server/billing.js';
import { sendJson, readJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { prompt, tasks, globalInstruction, selectedTaskId, modelId, userId } = await readJson(req);
    if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
    const isFreeModel = modelId === 'meta-llama/llama-3.3-70b-instruct:free';
    if (!isFreeModel) {
      const bal = await getBalance(userId);
      if (bal <= 0) return sendJson(res, 402, { error: 'Insufficient balance' });
    }
    const result = await chatWithPlanner({ prompt, tasks, globalInstruction, selectedTaskId, modelId });
    if (!isFreeModel && result.totalCostUsd > 0) {
      const amountCents = Math.ceil(result.totalCostUsd * 100 * 2); // double charge (100% margin)
      await chargeUsage({
        userId,
        amountCents,
        model: result.modelUsed,
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
        description: 'AI coach charge (non-refundable)'
      });
    }
    return sendJson(res, 200, { content: result.content, attachmentsUsed: result.attachmentsUsed || [] });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Unknown error' });
  }
}
