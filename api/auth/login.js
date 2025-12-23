import { loginUser } from '../../server/auth.js';
import { readJson, sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const { email, password } = await readJson(req);
    if (!email || !password) return sendJson(res, 400, { error: 'Missing fields' });
    const user = await loginUser(email, password);
    return sendJson(res, 200, user);
  } catch (err) {
    return sendJson(res, 400, { error: (err && err.message) || 'Login failed' });
  }
}
