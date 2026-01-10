import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'no-reply@notifications.ethanyanxu.com';
const RAW_APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
const RAW_API_BASE_URL = process.env.API_BASE_URL || RAW_APP_BASE_URL;
const withScheme = (value) =>
  value.startsWith('http://') || value.startsWith('https://') ? value : `http://${value}`;
const APP_BASE_URL = withScheme(RAW_APP_BASE_URL).replace(/\/+$/, '');
const API_BASE_URL = withScheme(RAW_API_BASE_URL).replace(/\/+$/, '');

const client = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export const sendVerificationEmail = async (to, token) => {
  const verifyUrl = `${API_BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  if (!client) {
    console.warn('Resend not configured; skipping email send.');
    console.warn(`[email] manual verification URL for ${to}: ${verifyUrl}`);
    return;
  }
  console.log(
    `[email] sending verification to ${to} from ${RESEND_FROM} (key present=${!!RESEND_API_KEY}, base=${APP_BASE_URL})`
  );
  console.log(`[email] verification URL: ${verifyUrl}`);
  try {
    console.log('[email] calling client.emails.send...');
    const resp = await client.emails.send({
      from: RESEND_FROM,
      to,
      subject: 'Confirm your email for YanPlanner',
      html: `
        <p>Please confirm your email to finish creating your YanPlanner account.</p>
        <p><a href="${verifyUrl}">Confirm email</a></p>
        <p>If you did not request this, you can ignore this email.</p>
      `
    });
    console.log('[email] client.emails.send completed');
    console.log(`[email] response:`, JSON.stringify(resp, null, 2));
    console.log(`[email] sent verification to ${to} (id=${resp?.data?.id || 'n/a'})`);
  } catch (err) {
    console.error('[email] failed to send verification', err);
    console.error('[email] error details:', err.message, err.statusCode, err.name);
    // Log the manual link so you can verify even if email failed (e.g., no network)
    console.warn(`[email] manual verification URL for ${to}: ${verifyUrl}`);
  }
};
