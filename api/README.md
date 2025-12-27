# API (Legacy)

This folder contains legacy Vercel serverless function handlers. In the current architecture, these files are NOT used.

- Unified backend: Both development and production use the Express server in `server/index.js`.
- Routing: The client targets the API base defined in `src/lib/api-client.js`.
  - Development: `http://localhost:8787` (Express)
  - Production: Vercel rewrites `/api/*` to your Koyeb app per `vercel.json`, which serves the same Express app.
- Reason: Keeping a single API implementation avoids drift (e.g., persistence differences).

If you decide to switch back to serverless functions, remove the rewrite in `vercel.json` and ensure parity with the Express routes.
