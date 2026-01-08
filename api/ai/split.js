import { generateSubtasks } from '../../server/ai.js';
import { getBalance, chargeUsage } from '../../server/billing.js';
import { sendJson, readJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';
import { applyWebSearchSetting, isFreeModel } from '../../shared/model-config.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { task, ancestors, conversation, globalInstruction, modelId, webSearchEnabled, userId, clientLocalDate, clientTimeZone } = await readJson(req);
    if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
    const resolvedModelId = applyWebSearchSetting(modelId, webSearchEnabled);
    const isFree = isFreeModel(resolvedModelId);
    if (!isFree) {
      const bal = await getBalance(userId);
      if (bal < 50) return sendJson(res, 402, { error: 'Minimum balance of $0.50 required to use AI features' });
    }
    const result = await generateSubtasks({ task, ancestors, conversation, globalInstruction, modelId: resolvedModelId, webSearchEnabled, clientLocalDate, clientTimeZone });
    if (!isFree && result.totalCostUsd > 0) {
      const amountCents = Math.ceil(result.totalCostUsd * 100 * 2); // double charge (100% margin)
      await chargeUsage({
        userId,
        amountCents,
        model: result.modelUsed,
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
        description: 'AI split charge (non-refundable)'
      });
    }
    return sendJson(res, 200, { items: result.items });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Unknown error' });
  }
}
