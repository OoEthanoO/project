#!/bin/bash

# YanPlanner Database Backup Script
# Creates a timestamped backup of the PostgreSQL database

DATABASE_URL="postgresql://neondb_owner:npg_7YpfDd3xMoEs@ep-rapid-paper-ahqvxbko-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Create backups directory if it doesn't exist
mkdir -p backups

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backups/yanplanner_backup_${TIMESTAMP}.sql"

echo "🔄 Starting database backup..."
echo "📁 Backup file: $BACKUP_FILE"

# Try pg_dump with --no-sync flag to ignore version warnings
echo "Attempting pg_dump..."
pg_dump --no-sync "$DATABASE_URL" > "$BACKUP_FILE" 2>/dev/null

if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
    echo "✅ Backup successful!"
    echo "📊 File size: $(du -h "$BACKUP_FILE" | cut -f1)"
    echo "💾 Location: $BACKUP_FILE"
    
    # Keep only last 10 backups
    ls -t backups/yanplanner_backup_*.sql 2>/dev/null | tail -n +11 | xargs rm -f
    echo "🧹 Old backups cleaned (keeping last 10)"
else
    echo "⚠️  pg_dump failed (likely version mismatch), trying Node.js export..."
    rm -f "$BACKUP_FILE"
    
    # Fallback to Node.js export (with DATABASE_URL)
    DATABASE_URL="$DATABASE_URL" node export-user-data.js
    
    if [ $? -eq 0 ]; then
        echo "✅ Backup successful via Node.js export!"
        echo "💡 Tip: To fix pg_dump, upgrade to PostgreSQL 17:"
        echo "   brew install postgresql@17"
        echo "   brew link --overwrite postgresql@17"
    else
        echo "❌ All backup methods failed!"
        exit 1
    fi
fi
