import '../_lib/env.js';
import { registerUser } from '../../server/auth.js';
import { readJson, sendJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { email, password, name } = await readJson(req);
    if (!email || !password || !name) return sendJson(res, 400, { error: 'Missing fields' });
    const user = await registerUser(email, password, name);
    return sendJson(res, 200, user);
  } catch (err) {
    return sendJson(res, 400, { error: (err && err.message) || 'Registration failed' });
  }
}
