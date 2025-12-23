import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pkgPg from 'pg';
import { execSync } from 'child_process';

let PrismaClient;
try {
  const pkgPrisma = await import('@prisma/client');
  PrismaClient = pkgPrisma.PrismaClient;
} catch (err) {
  // If the generated client is missing, generate it at runtime
  if (err && err.code === 'MODULE_NOT_FOUND') {
    try {
      console.log('[prisma] Client not found; running prisma generate...');
      execSync('npx prisma generate', { stdio: 'inherit' });
      const pkgPrisma2 = await import('@prisma/client');
      PrismaClient = pkgPrisma2.PrismaClient;
    } catch (genErr) {
      console.error('[prisma] Failed to generate Prisma client', genErr);
      throw genErr;
    }
  } else {
    throw err;
  }
}

const { Pool } = pkgPg;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Missing DATABASE_URL for Prisma');
}

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);

// Reuse the client across hot reloads
const prisma =
  globalThis.__plannerPrisma ||
  new PrismaClient({
    adapter
  });

if (!globalThis.__plannerPrisma) {
  globalThis.__plannerPrisma = prisma;
}

export { prisma };
