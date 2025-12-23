import { getBalance } from '../../server/billing.js';
import { sendJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (!userId) return sendJson(res, 400, { error: 'Missing userId' });
    const balanceCents = await getBalance(userId);
    return sendJson(res, 200, { balanceCents });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Failed to fetch balance' });
  }
}
