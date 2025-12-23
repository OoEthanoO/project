# Cloudflare R2 File Storage Setup

## Overview
This application uses Cloudflare R2 for persistent file storage. R2 is S3-compatible object storage with generous free tier (10GB storage, unlimited egress).

## Why R2?
- **Payload Limit**: Vercel serverless functions have 4.5MB payload limit. Storing base64 files in database exceeds this with multiple attachments.
- **Persistence**: Session-only memory storage loses files on refresh.
- **Cost**: R2 free tier provides 10GB storage with no bandwidth charges.

## Setup Instructions

### 1. Create Cloudflare Account
- Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
- Sign up or log in

### 2. Create R2 Bucket
- Navigate to R2 in the dashboard
- Click "Create bucket"
- Name: `yanplanner` (or your preferred name)
- Location: Automatic
- Create bucket

### 3. Generate API Token
- In R2 dashboard, click "Manage R2 API Tokens"
- Click "Create API token"
- Permissions: Object Read & Write
- Copy the generated credentials:
  - Access Key ID
  - Secret Access Key
  - Account ID (from R2 overview page)

### 4. Configure Environment Variables
Add to your `.env` file:

```bash
R2_ACCOUNT_ID=your-account-id-here
R2_ACCESS_KEY_ID=your-access-key-id-here
R2_SECRET_ACCESS_KEY=your-secret-access-key-here
R2_BUCKET_NAME=yanplanner
```

### 5. Restart Development Server
```bash
# Stop current server (Ctrl+C)
vercel dev
```

## Architecture

### File Upload Flow
1. User selects file in TaskForm
2. Frontend extracts file as base64 (`file-extract.js`)
3. POST to `/api/upload` with base64 data
4. Backend converts to buffer and uploads to R2
5. R2 returns storage key (e.g., `user123/1234567890-file.pdf`)
6. Frontend stores r2Key in attachment metadata
7. saveState persists r2Key to database (not dataUrl)

### File Retrieval Flow
1. AI needs file from attachment with r2Key
2. Backend calls `downloadFromR2(r2Key)` (`server/r2.js`)
3. R2 returns file buffer
4. Convert to dataUrl for OpenRouter API
5. Send to AI model for processing

## Key Files

### Backend
- `server/r2.js`: R2 client wrapper (upload, download, signed URLs)
- `api/upload.js`: File upload endpoint (base64 → R2)
- `server/ai.js`: Fetches files from R2 when AI needs them

### Frontend
- `src/lib/file-extract.js`: Uploads files to R2, returns r2Key
- `src/lib/state.js`: Strips dataUrl but keeps r2Key when saving
- `src/types.ts`: Attachment type includes r2Key field

## Data Structure

### Attachment Object (In Database)
```javascript
{
  id: "abc123",
  name: "document.pdf",
  size: 1024000,
  type: "application/pdf",
  contentType: "application/pdf",
  r2Key: "user123/1234567890-document.pdf", // R2 storage key
  extractionStatus: "ok"
  // NO dataUrl - too large for database
}
```

### Attachment Object (In Memory During Session)
```javascript
{
  id: "abc123",
  name: "document.pdf",
  r2Key: "user123/1234567890-document.pdf",
  dataUrl: "data:application/pdf;base64,..." // Fetched from R2 when needed
}
```

## Troubleshooting

### Upload Fails with "Missing R2 credentials"
- Verify all 4 environment variables are set in `.env`
- Restart `vercel dev` after changing `.env`
- Check variables with: `echo $R2_ACCOUNT_ID` in terminal

### Files Lost After Refresh
- Check database - r2Key should be persisted
- Verify saveState is called after adding tasks
- Files are fetched from R2 on-demand, not stored in memory

### AI Cannot Access Files
- Check server logs for R2 download errors
- Verify r2Key exists in attachment metadata
- Ensure bucket permissions allow read access

### 413 Payload Too Large
- Verify files are uploading to R2 (check `/api/upload` logs)
- Confirm r2Key is stored instead of dataUrl
- Check state.js is stripping dataUrl before saving

## Free Tier Limits
- **Storage**: 10GB/month
- **Class A Operations** (write, list): 1M/month
- **Class B Operations** (read): 10M/month
- **Egress**: UNLIMITED (no charges)

With typical usage (100 files @ 5MB each), you'll use:
- Storage: 500MB (5% of limit)
- Writes: 100 operations (0.01% of limit)
- Reads: ~1000 operations (0.01% of limit)

## Migration Notes
Files uploaded before R2 integration:
- Old tasks may have empty attachments array
- User must re-upload files for those tasks
- Consider adding migration script if needed

Files uploaded during transition:
- Some may have dataUrl, some may have r2Key
- Backend handles both formats gracefully
- dataUrl will be stripped on next save
