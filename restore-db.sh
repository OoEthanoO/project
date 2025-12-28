#!/bin/bash

# YanPlanner Database Restore Script
# Restores database from a backup file

DATABASE_URL="postgresql://neondb_owner:npg_7YpfDd3xMoEs@ep-rapid-paper-ahqvxbko-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

if [ -z "$1" ]; then
    echo "❌ Usage: ./restore-db.sh <backup_file>"
    echo "Available backups:"
    ls -lh backups/yanplanner_backup_*.sql 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "⚠️  WARNING: This will restore the database from:"
echo "   $BACKUP_FILE"
echo "   This will OVERWRITE current data!"
read -p "Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Restore cancelled"
    exit 0
fi

echo "🔄 Restoring database..."

# Drop and recreate schema (careful!)
psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

# Restore from backup
psql "$DATABASE_URL" < "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Restore successful!"
    echo "🔄 Running Prisma migrations to ensure schema is up to date..."
    npx prisma migrate deploy
else
    echo "❌ Restore failed!"
    exit 1
fi
