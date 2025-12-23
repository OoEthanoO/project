import { topUpBalance } from '../../server/billing.js';
import { readJson, sendJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { userId, amountCents, reference, idempotencyKey } = await readJson(req);
    if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
    if (amountCents == null) return sendJson(res, 400, { error: 'Missing amountCents' });
    if (!idempotencyKey) return sendJson(res, 400, { error: 'Missing idempotencyKey' });
    const result = await topUpBalance({ userId, amountCents, reference, idempotencyKey });
    return sendJson(res, 200, { ...result, nonRefundable: true });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Failed to top up' });
  }
}
