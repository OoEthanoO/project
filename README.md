# YanPlanner

Turn assignments, exams, and projects into day-by-day plans. Add tasks with due dates, attach materials, then let the AI split work into actionable subtasks. A context-aware chat lets you reshape plans, tune due dates, and keep decisions in sync.

## Features
- Add tasks with descriptions, due dates, and file attachments.
- AI-assisted splitting: break any task (and subtasks) into smaller items that inherit context from titles, descriptions, and attachments.
- Nested hierarchy: subtasks are indented beneath their parent so the whole plan is visible at a glance.
- Contextual chat: talk to the planner to refine dates, adjust scope, or get pacing guidance; conversation is used as context for AI splits.
- Modern UI: gradient styling, quick chips, and focused cards keep planning fast.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Unified API server (dev + prod):
   - Both development and production use the same Express server defined in `server/index.js`.
   - In development, the frontend calls `http://localhost:8787`.
   - In production (Vercel), `/api/*` is rewritten to your Koyeb app per `vercel.json`, which also serves the same Express app.
   - The files under `api/` are legacy serverless routes and are not used; see `api/README.md`.
3. Run locally:
   ```bash
   # Terminal 1: start the API server
   npm run server

   # Terminal 2: start the Vite dev server
   npm run dev
   ```
   Open http://localhost:5173.

## AI setup
- Create a `.env` (Vercel functions read these; the client does not call OpenRouter directly):
  ```bash
  OPENROUTER_API_KEY=sk-...
  # OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions # override if needed
  ```
- The model defaults to Tier 0 (free text-only model). Users can change models in the UI dropdown.
- All `/api/ai/*` calls go through the Express server.

## File storage (Cloudflare R2)
- Attachments are stored in Cloudflare R2 (S3-compatible storage) to avoid serverless payload limits.
- **Setup R2:**
  1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → R2
  2. Create a bucket (e.g., `yanplanner`)
  3. Generate API tokens: Manage R2 API Tokens → Create API Token
  4. Add to `.env`:
     ```bash
     R2_ACCOUNT_ID=your-account-id
     R2_ACCESS_KEY_ID=your-access-key
     R2_SECRET_ACCESS_KEY=your-secret-key
     R2_BUCKET_NAME=yanplanner
     ```
- **Free tier:** 10GB storage, unlimited egress (no bandwidth fees)
- Without R2, file uploads will fail. Attachments are required for multimodal AI features.

- No tests included yet; run `npm run lint` once dependencies are installed to type-check the project.
- The app starts empty; add your own tasks to begin planning.

## Persistence
- Tasks, trash, chat history, and global instructions are saved via the Express API. Ensure `DATABASE_URL` is set for Prisma. The legacy serverless functions in `api/` are deprecated and not invoked.
