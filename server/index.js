import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chatWithPlanner, generateSubtasks } from './ai.js';
import { loginUser, registerUser } from './auth.js';
import { getUserState, saveUserState } from './state.js';
import { getBalance, topUpBalance, chargeUsage } from './billing.js';
import { createCheckoutSession, handleStripeWebhook } from './stripe.js';
import { prisma } from './prisma.js';
import { isFreeModel } from '../shared/model-config.js';

const normalizeBaseUrl = (value) => {
  if (!value) return 'http://localhost:5173';
  const trimmed = value.trim();
  const hasScheme = /^https?:\/\//i.test(trimmed);
  if (hasScheme) return trimmed;
  const isLocal = trimmed.startsWith('localhost') || trimmed.startsWith('127.') || trimmed.includes('://localhost');
  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
};

const chargeFailedAiRequest = async ({ userId, billing, description }) => {
  if (!billing || !billing.totalCostUsd || billing.totalCostUsd <= 0) return null;
  const amountCents = Math.ceil(billing.totalCostUsd * 100 * 2);
  try {
    await chargeUsage({
      userId,
      amountCents,
      model: billing.modelUsed,
      promptTokens: billing.usage?.prompt_tokens || 0,
      completionTokens: billing.usage?.completion_tokens || 0,
      description
    });
    console.warn('[billing] Charged for failed AI request:', {
      userId,
      amountCents,
      model: billing.modelUsed
    });
    return amountCents;
  } catch (err) {
    console.error('[billing] Failed to charge for failed AI request:', err);
    return null;
  }
};

const app = express();
// Environment diagnostics (no secrets printed)
console.log('[env] DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('[env] APP_BASE_URL set:', !!process.env.APP_BASE_URL);
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// Robust CORS: allow frontend origin and handle preflight
const allowedOrigin = normalizeBaseUrl(process.env.APP_BASE_URL || 'http://localhost:5173');
app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (e.g., curl) and the configured frontend
    if (!origin) return cb(null, true);
    try {
      const allowed = allowedOrigin === '*' || origin === allowedOrigin;
      return cb(null, allowed);
    } catch {
      return cb(null, false);
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-key', 'x-admin-email']
}));
app.options('*', cors());

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.post('/api/ai/split', async (req, res) => {
  try {
    const { task, ancestors = [], conversation, globalInstruction, modelId, userId, clientLocalDate, clientTimeZone } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const isFree = isFreeModel(modelId);
    if (!isFree) {
      const bal = await getBalance(userId);
      if (bal < 50) return res.status(402).json({ error: 'Minimum balance of $0.50 required to use AI features' });
    }
    const result = await generateSubtasks({ task, ancestors, conversation, globalInstruction, modelId, clientLocalDate, clientTimeZone });
    if (result.totalCostUsd > 0) {
      const amountCents = Math.ceil(result.totalCostUsd * 100 * 2); // 100% revenue -> double charge
      await chargeUsage({
        userId,
        amountCents,
        model: result.modelUsed,
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
        description: 'AI split charge (non-refundable)'
      });
    }
    res.json({ items: result.items });
  } catch (err) {
    const billing = err?.billing;
    if (billing?.totalCostUsd) {
      await chargeFailedAiRequest({
        userId: req.body?.userId,
        billing,
        description: 'AI split charge (failed request)'
      });
    }
    res.status(500).json({ error: (err && err.message) || 'Unknown error' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, tasks, globalInstruction, selectedTaskId, modelId, userId, clientLocalDate, clientTimeZone } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const isFree = isFreeModel(modelId);
    if (!isFree) {
      const bal = await getBalance(userId);
      if (bal < 50) return res.status(402).json({ error: 'Minimum balance of $0.50 required to use AI features' });
    }
    const result = await chatWithPlanner({ prompt, tasks, globalInstruction, selectedTaskId, modelId, clientLocalDate, clientTimeZone });
    if (result.totalCostUsd > 0) {
      const amountCents = Math.ceil(result.totalCostUsd * 100 * 2); // 100% revenue -> double charge
      await chargeUsage({
        userId,
        amountCents,
        model: result.modelUsed,
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
        description: 'AI coach charge (non-refundable)'
      });
    }
    res.json({ content: result.content });
  } catch (err) {
    const billing = err?.billing;
    if (billing?.totalCostUsd) {
      await chargeFailedAiRequest({
        userId: req.body?.userId,
        billing,
        description: 'AI coach charge (failed request)'
      });
    }
    res.status(500).json({ error: (err && err.message) || 'Unknown error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });
    const user = await registerUser(email, password, name);
    return res.json(user);
  } catch (err) {
    console.error('[api/auth/register] error', err);
    res.status(400).json({ error: (err && err.message) || 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    const user = await loginUser(email, password);
    return res.json(user);
  } catch (err) {
    console.error('[api/auth/login] error', err);
    res.status(400).json({ error: (err && err.message) || 'Login failed' });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send('Missing token');
    const user = await prisma.user.findFirst({ where: { verificationToken: token } });
    if (!user) return res.status(400).send('Invalid token');
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationToken: null }
    });
    const appUrl = normalizeBaseUrl(process.env.APP_BASE_URL || 'http://localhost:5173');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
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
      </html>`);
  } catch (err) {
    res.status(400).send((err && err.message) || 'Verification failed');
  }
});

app.get('/api/state', async (req, res) => {
  try {
    // Handle version check (no userId required)
    if (req.query.version !== undefined) {
      // Use same version resolution as Vercel endpoint for consistency
      const version = process.env.VERCEL_GIT_COMMIT_SHA || 
                      process.env.VERCEL_DEPLOYMENT_ID || 
                      process.env.BUILD_ID || 
                      process.env.npm_package_version || 
                      'unknown';
      return res.json({ version });
    }
    
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const state = await getUserState(userId);
    res.json(state);
  } catch (err) {
    console.error('Failed to load state', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to load state' });
  }
});

app.post('/api/state', async (req, res) => {
  try {
    const { userId, tasks, chat, trash, config, selectedTaskId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const state = await saveUserState(userId, { tasks, chat, trash, config, selectedTaskId });
    res.json(state);
  } catch (err) {
    console.error('Failed to save state', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to save state' });
  }
});

app.delete('/api/state', async (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid keys array' });
    }
    
    // Import R2 helper and delete files
    const { deleteMultipleFromR2 } = await import('./r2.js');
    await deleteMultipleFromR2(keys);
    
    res.json({ deleted: keys.length });
  } catch (err) {
    console.error('Failed to delete files', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to delete files' });
  }
});

app.get('/api/billing/balance', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const balanceCents = await getBalance(userId);
    res.json({ balanceCents });
  } catch (err) {
    console.error('Failed to fetch balance', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to fetch balance' });
  }
});

app.post('/api/billing/topup', async (req, res) => {
  try {
    const { userId, amountCents, reference, idempotencyKey } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (amountCents == null) return res.status(400).json({ error: 'Missing amountCents' });
    if (!idempotencyKey) return res.status(400).json({ error: 'Missing idempotencyKey' });
    const result = await topUpBalance({ userId, amountCents, reference, idempotencyKey });
    res.json({ ...result, nonRefundable: true });
  } catch (err) {
    console.error('Failed to top up', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to top up' });
  }
});

app.post('/api/payments/stripe/checkout', async (req, res) => {
  try {
    const { userId, amountCents } = req.body;
    if (!userId || amountCents == null) return res.status(400).json({ error: 'Missing userId or amountCents' });
    const session = await createCheckoutSession({ userId, amountCents });
    res.json(session);
  } catch (err) {
    console.error('Failed to create checkout session', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to create checkout session' });
  }
});

app.post('/api/payments/stripe/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  try {
    await handleStripeWebhook(req.body, signature);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error', err);
    res.status(400).send(`Webhook Error: ${(err && err.message) || 'unknown'}`);
  }
});

app.post('/api/upload-url', async (req, res) => {
  try {
    const { userId, fileName, contentType } = req.body;
    if (!userId || !fileName || !contentType) {
      return res.status(400).json({ error: 'Missing userId, fileName, or contentType' });
    }
    
    // Check balance before issuing upload URL
    const bal = await getBalance(userId);
    if (bal < 50) {
      return res.status(402).json({ error: 'Minimum balance of $0.50 required for file uploads' });
    }
    
    // Import R2 helper
    const { getPresignedUploadUrl } = await import('./r2.js');
    
    // Generate unique key and presigned URL
    const key = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const uploadUrl = await getPresignedUploadUrl(key, contentType);
    
    res.json({ uploadUrl, key });
  } catch (err) {
    console.error('Failed to generate upload URL', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to generate upload URL' });
  }
});

app.get('/api/admin/summary', async (req, res) => {
  try {
    const apiKey = req.headers['x-admin-key'];
    const adminEmail = req.headers['x-admin-email'];
    
    if (!apiKey || !adminEmail) {
      return res.status(401).json({ error: 'Missing admin credentials' });
    }
    
    // Validate admin API key
    if (apiKey !== process.env.ADMIN_API_KEY || adminEmail !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Invalid admin credentials' });
    }
    
    // Fetch summary data
    const userCount = await prisma.user.count();
    const totalBalance = await prisma.user.aggregate({
      _sum: { balanceCents: true }
    });
    
    const topBalances = await prisma.user.findMany({
      select: { id: true, email: true, name: true, balanceCents: true, createdAt: true },
      orderBy: { balanceCents: 'desc' },
      take: 10
    });
    
    const topups = await prisma.topUpTransaction.aggregate({
      _count: true,
      _sum: { amountCents: true }
    });
    
    const usages = await prisma.usageTransaction.aggregate({
      _count: true,
      _sum: { amountCents: true }
    });
    
    const recentTopups = await prisma.topUpTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    
    res.json({
      adminEmail: process.env.ADMIN_EMAIL,
      userCount,
      totalBalanceCents: totalBalance._sum.balanceCents || 0,
      topBalances,
      topupCount: topups._count,
      topupSumCents: topups._sum.amountCents || 0,
      usageCount: usages._count,
      usageSumCents: usages._sum.amountCents || 0,
      recentTopups
    });
  } catch (err) {
    console.error('Failed to fetch admin summary', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to fetch admin summary' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
