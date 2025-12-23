import '../_lib/env.js';
import { prisma } from '../../server/prisma.js';
import { sendJson, sendHtml } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) return sendJson(res, 400, { error: 'Missing token' });
    const user = await prisma.user.findFirst({ where: { verificationToken: token } });
    if (!user) return sendJson(res, 400, { error: 'Invalid token' });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true, verificationToken: null } });
    const appUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Email verified</title>
          <style>
            body { font-family: Inter, system-ui, -apple-system, sans-serif; background:#0b0d16; color:#e9ecf3; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
            .card { background:linear-gradient(135deg,#151a2a,#101522); border:1px solid #1f2a44; padding:32px; border-radius:16px; width: min(420px, 90vw); box-shadow:0 20px 50px rgba(0,0,0,0.35); }
            h1 { margin:0 0 8px 0; font-size:24px; }
            p { margin:8px 0; color:#b7c2d5; line-height:1.5; }
            a.button { display:inline-block; margin-top:16px; background:#5bd0ff; color:#031124; padding:12px 16px; border-radius:10px; text-decoration:none; font-weight:600; }
            .sub { font-size:13px; color:#8ea2c6; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Email verified ✅</h1>
            <p>Your email has been confirmed. You can now sign in to YanPlanner.</p>
            <a class="button" href="${appUrl}">Open YanPlanner</a>
            <p class="sub">If the button does not work, copy and paste this URL: ${appUrl}</p>
          </div>
        </body>
      </html>
    `;
    return sendHtml(res, 200, html);
  } catch (err) {
    return sendJson(res, 400, { error: (err && err.message) || 'Verification failed' });
  }
}
