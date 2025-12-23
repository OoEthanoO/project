import { prisma } from './prisma.js';

const clampCents = (amountCents) => {
  const min = 1; // $0.01 minimum
  const max = 100_000_00; // $100,000 cap for safety
  if (!Number.isInteger(amountCents)) throw new Error('Amount must be an integer number of cents.');
  if (amountCents < min) throw new Error('Minimum top-up is $0.01.');
  if (amountCents > max) throw new Error('Top-up exceeds safety cap.');
  return amountCents;
};

const ensureIdempotencyKey = (key) => {
  if (!key || typeof key !== 'string' || key.length < 8) {
    throw new Error('Missing idempotencyKey (>= 8 chars).');
  }
  return key;
};

export const getBalance = async (userId) => {
  if (!userId) throw new Error('Missing userId');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { balanceCents: true } });
  if (!user) throw new Error('User not found');
  return user.balanceCents || 0;
};

export const topUpBalance = async ({ userId, amountCents, reference, idempotencyKey, provider = 'manual', providerRef }) => {
  if (!userId) throw new Error('Missing userId');
  const amount = clampCents(amountCents);
  const idem = ensureIdempotencyKey(idempotencyKey);
  return await prisma.$transaction(async (tx) => {
    // Idempotent: return existing transaction outcome without double-crediting
    const existing = await tx.topUpTransaction.findUnique({ where: { idempotencyKey: idem } });
    if (existing) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { balanceCents: true } });
      return { balanceCents: user?.balanceCents ?? 0, transactionId: existing.id, status: existing.status };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { balanceCents: true } });
    if (!user) throw new Error('User not found');

    // Create record first, then credit balance to ensure traceability
    const txn = await tx.topUpTransaction.create({
      data: {
        userId,
        amountCents: amount,
        reference: reference || 'manual-topup',
        status: 'completed',
        note: 'Non-refundable top-up',
        provider,
        providerRef,
        idempotencyKey: idem,
        completedAt: new Date()
      }
    });

    const updated = await tx.user.update({
      where: { id: userId },
      data: { balanceCents: user.balanceCents + amount }
    });

    return { balanceCents: updated.balanceCents, transactionId: txn.id, status: txn.status };
  });
};

export const chargeUsage = async ({ userId, amountCents, model, promptTokens = 0, completionTokens = 0, description }) => {
  if (!userId) throw new Error('Missing userId');
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('Charge must be a positive integer in cents.');
  if (!prisma.usageTransaction) {
    throw new Error('Usage transactions are unavailable. Run Prisma migrations and regenerate the client.');
  }
  const amount = amountCents;
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { balanceCents: true } });
    if (!user) throw new Error('User not found');
    if (user.balanceCents < amount) {
      throw new Error('Insufficient balance for this request.');
    }
    const updated = await tx.user.update({
      where: { id: userId },
      data: { balanceCents: user.balanceCents - amount }
    });
    const txn = await tx.usageTransaction.create({
      data: {
        userId,
        amountCents: amount,
        model: model || 'unknown',
        promptTokens,
        completionTokens,
        description: description || 'AI request charge (non-refundable)'
      }
    });
    return { balanceCents: updated.balanceCents, transactionId: txn.id };
  });
};
