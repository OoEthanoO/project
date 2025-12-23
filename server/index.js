import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chatWithPlanner, generateSubtasks } from './ai.js';
import { loginUser, registerUser } from './auth.js';
import { getUserState, saveUserState } from './state.js';
import { getBalance, topUpBalance, chargeUsage } from './billing.js';
import { createCheckoutSession, handleStripeWebhook } from './stripe.js';
import { prisma } from './prisma.js';

const app = express();
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(cors());

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
    const { task, conversation, globalInstruction, modelId, userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const isFreeModel = modelId === 'meta-llama/llama-3.3-70b-instruct:free';
    if (!isFreeModel) {
      const bal = await getBalance(userId);
      if (bal <= 0) return res.status(402).json({ error: 'Insufficient balance' });
    }
    const result = await generateSubtasks({ task, conversation, globalInstruction, modelId });
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
    res.status(500).json({ error: (err && err.message) || 'Unknown error' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, tasks, globalInstruction, selectedTaskId, modelId, userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const isFreeModel = modelId === 'meta-llama/llama-3.3-70b-instruct:free';
    if (!isFreeModel) {
      const bal = await getBalance(userId);
      if (bal <= 0) return res.status(402).json({ error: 'Insufficient balance' });
    }
    const result = await chatWithPlanner({ prompt, tasks, globalInstruction, selectedTaskId, modelId });
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
    const appUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
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
    const { userId, tasks, chat, config, selectedTaskId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const state = await saveUserState(userId, { tasks, chat, config, selectedTaskId });
    res.json(state);
  } catch (err) {
    console.error('Failed to save state', err);
    res.status(500).json({ error: (err && err.message) || 'Failed to save state' });
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

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
