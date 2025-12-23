import 'dotenv/config';
import { defineConfig } from '@prisma/config';

// Make generation resilient when DATABASE_URL is not set during build.
// Prisma does not connect on generate; a placeholder URL is acceptable.
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/placeholder';

export default defineConfig({
  datasource: {
    provider: 'postgresql',
    url: databaseUrl
  }
});
