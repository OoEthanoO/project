-- Ensure uuid generator extension is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Add columns with defaults so existing rows are populated
ALTER TABLE "TopUpTransaction"
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "providerRef" TEXT;

-- Backfill any null idempotencyKey values (safety)
UPDATE "TopUpTransaction" SET "idempotencyKey" = gen_random_uuid() WHERE "idempotencyKey" IS NULL;

-- Enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS "TopUpTransaction_idempotencyKey_key" ON "TopUpTransaction"("idempotencyKey");
