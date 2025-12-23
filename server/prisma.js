import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from 'pg';

const { Pool } = pkg;

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
