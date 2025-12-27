-- Add trash can storage for soft-deleted tasks
ALTER TABLE "UserState" ADD COLUMN "trash" JSONB NOT NULL DEFAULT '[]';
