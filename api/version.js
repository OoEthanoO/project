import { sendJson } from './_lib/http.js';

const version =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.BUILD_ID ||
  'local';

export default function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  return sendJson(res, 200, { version });
}
