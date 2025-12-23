import Stripe from 'stripe';
import { topUpBalance } from './billing.js';

const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const rawAppBaseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
const makeBase = (value) => {
  try {
    // If the value lacks scheme, default to https:// for production-like hostnames, http:// for localhost
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      const isLocal = trimmed.startsWith('localhost') || trimmed.startsWith('127.') || trimmed.includes('://localhost');
      return isLocal ? `http://${trimmed}` : `https://${trimmed}`;
    }
    return trimmed;
  } catch {
    return 'http://localhost:5173';
  }
};
const appBaseUrl = makeBase(rawAppBaseUrl);

const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2024-10-28.acacia' }) : null;

export const createCheckoutSession = async ({ userId, amountCents, successPath = '/payment-success', cancelPath = '/' }) => {
  if (!stripe) throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY.');
  if (!userId) throw new Error('Missing userId');
  if (!Number.isInteger(amountCents) || amountCents < 1) throw new Error('Minimum top-up is $0.01');

  const successUrl = new URL(successPath, appBaseUrl).toString();
  const cancelUrl = new URL(cancelPath, appBaseUrl).toString();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Account top-up (non-refundable)' },
          unit_amount: amountCents
        },
        quantity: 1
      }
    ],
    metadata: {
      userId,
      amountCents: amountCents.toString()
    }
  });
  return { url: session.url, sessionId: session.id };
};

export const handleStripeWebhook = async (rawBody, signature) => {
  if (!stripe) throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY.');
  if (!stripeWebhookSecret) throw new Error('Missing STRIPE_WEBHOOK_SECRET for webhook verification.');

  const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const amountCents = session.amount_total;
    const idempotencyKey = event.id;
    if (userId && Number.isInteger(amountCents)) {
      await topUpBalance({
        userId,
        amountCents,
        reference: session.id,
        idempotencyKey,
        provider: 'stripe',
        providerRef: session.payment_intent || session.id
      });
    }
  }

  return { received: true };
};
