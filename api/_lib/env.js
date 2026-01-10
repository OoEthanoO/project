// Ensure environment variables are loaded for serverless handlers when using `vercel dev`.
// Vercel automatically injects .env/.env.local, but in some local setups loading explicitly
// helps keep parity with the Express dev server.
import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import fs from 'fs';

if (!process.env.DATABASE_URL) {
  const candidates = ['.env.local', '.env.production', '.env'];
  for (const path of candidates) {
    if (fs.existsSync(path)) {
      dotenvConfig({ path });
      if (process.env.DATABASE_URL) break;
    }
  }
}
