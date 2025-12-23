import { handleStripeWebhook } from '../../../server/stripe.js';
import { readRaw, sendJson } from '../../_lib/http.js';

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const raw = await readRaw(req);
    const signature = req.headers['stripe-signature'];
    await handleStripeWebhook(raw, signature);
    return sendJson(res, 200, { received: true });
  } catch (err) {
    console.error('Stripe webhook error', err);
    res.statusCode = 400;
    res.end(`Webhook Error: ${(err && err.message) || 'unknown'}`);
  }
}
