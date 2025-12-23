// Ensure environment variables are loaded for serverless handlers when using `vercel dev`.
// Vercel automatically injects .env/.env.local, but in some local setups loading explicitly
// helps keep parity with the Express dev server.
import 'dotenv/config';
