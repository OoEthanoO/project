import '../_lib/env.js';
import { resendVerification } from '../../server/auth.js';
import { readJson, sendJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { email } = await readJson(req);
    if (!email) return sendJson(res, 400, { error: 'Missing email' });
    await resendVerification(email);
    return sendJson(res, 200, { message: 'If that email exists, a verification email has been sent.' });
  } catch (err) {
    console.error('[api/auth/resend] error', err);
    return sendJson(res, 400, { error: (err && err.message) || 'Resend failed' });
  }
}
