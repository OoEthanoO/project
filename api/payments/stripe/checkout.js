import { createCheckoutSession } from '../../../server/stripe.js';
import { readJson, sendJson } from '../../_lib/http.js';
import { logRequest } from '../../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { userId, amountCents } = await readJson(req);
    if (!userId || amountCents == null) return sendJson(res, 400, { error: 'Missing userId or amountCents' });
    const session = await createCheckoutSession({ userId, amountCents });
    return sendJson(res, 200, session);
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Failed to create checkout session' });
  }
}
