import '../_lib/env.js';
import { prisma } from '../../server/prisma.js';
import { sendJson } from '../_lib/http.js';
import { logRequest } from '../_lib/log.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ethanxucoder@gmail.com';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

export default async function handler(req, res) {
  logRequest(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const providedKey = req.headers['x-admin-key'] || req.query.key;
  const requesterEmail = req.headers['x-admin-email'] || req.query.email;

  if (!ADMIN_API_KEY) {
    return sendJson(res, 500, { error: 'ADMIN_API_KEY not configured.' });
  }
  if (providedKey !== ADMIN_API_KEY) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }
  if (requesterEmail && requesterEmail !== ADMIN_EMAIL) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  try {
    const userCount = await prisma.user.count();
    const totalBalanceAgg = await prisma.user.aggregate({ _sum: { balanceCents: true } });
    const totalBalanceCents = totalBalanceAgg._sum.balanceCents || 0;

    const topBalances = await prisma.user.findMany({
      orderBy: { balanceCents: 'desc' },
      take: 25,
      select: { id: true, email: true, name: true, balanceCents: true, createdAt: true }
    });

    const topupCount = await prisma.topUpTransaction?.count?.();
    const usageCount = await prisma.usageTransaction?.count?.();
    const topupSumAgg = await prisma.topUpTransaction?.aggregate?.({ _sum: { amountCents: true } });
    const usageSumAgg = await prisma.usageTransaction?.aggregate?.({ _sum: { amountCents: true } });

    const recentTopups = prisma.topUpTransaction
      ? await prisma.topUpTransaction.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, userId: true, amountCents: true, createdAt: true, provider: true, reference: true, status: true }
        })
      : [];

    return sendJson(res, 200, {
      adminEmail: ADMIN_EMAIL,
      userCount,
      totalBalanceCents,
      topBalances,
      topupCount,
      usageCount,
      topupSumCents: topupSumAgg?._sum?.amountCents || 0,
      usageSumCents: usageSumAgg?._sum?.amountCents || 0,
      recentTopups
    });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'Failed to load admin summary' });
  }
}
