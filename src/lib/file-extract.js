import { randomId } from './task-utils';
const TEXT_TYPES = [
    'text/plain',
    'text/markdown',
    'text/html',
    'application/json',
    'application/javascript',
    'application/typescript',
    'application/xml',
    'application/xhtml+xml'
];
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });
const fileIsTextual = (type) => TEXT_TYPES.includes(type) || type.startsWith('text/') || type.endsWith('+json') || type.endsWith('+xml');
const MAX_INLINE_BYTES = 200000; // 200 KB to avoid localStorage blowups
const MAX_IMAGE_BYTES = 10000000; // 10 MB limit for images
const MAX_PDF_BYTES = 10000000; // 10 MB limit for PDFs
const readFileAsText = async (file) => {
    if (typeof file.text === 'function') {
        return file.text();
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result || '');
        reader.readAsText(file);
    });
};
const readFileAsUtf8 = async (file) => {
    const buffer = await file.arrayBuffer();
    return UTF8_DECODER.decode(buffer);
};
const readFileAsDataUrl = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result || '');
        reader.readAsDataURL(file);
    });
};
export const extractAttachment = async (file, userId) => {
    const base = {
        id: randomId(),
        name: file.name,
        size: file.size,
        type: file.type,
        contentType: file.type
    };
    
    // Images and PDFs: upload to R2
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        if (file.size > MAX_IMAGE_BYTES) {
            return { ...base, extractionStatus: 'too-large', note: 'File too large (max 10MB)' };
        }
        if (!userId) {
            return { ...base, extractionStatus: 'error', note: 'Login required for file uploads' };
        }
        try {
            // Step 1: Get presigned upload URL from server
            const urlResponse = await fetch('/api/upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    userId
                })
            });
            
            if (!urlResponse.ok) {
                const error = await urlResponse.text();
                return { ...base, extractionStatus: 'error', note: `Upload failed: ${error}` };
            }
            
            const { uploadUrl, key } = await urlResponse.json();
            
            // Step 2: Upload file directly to R2 (bypasses Vercel payload limit)
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: { 
                    'Content-Type': file.type
                },
                body: file
            });
            
            if (!uploadResponse.ok) {
                const error = await uploadResponse.text();
                return { ...base, extractionStatus: 'error', note: `R2 upload failed: ${error}` };
            }
            
            console.log('✅ File uploaded directly to R2:', key);
            return { ...base, r2Key: key, extractionStatus: 'ok' };
        }
        catch (err) {
            return { ...base, extractionStatus: 'error', note: err.message };
        }
    }
    
    // Text files: extract content inline
    if (file.size > MAX_INLINE_BYTES) {
        return { ...base, extractionStatus: 'too-large', note: 'File too large to inline' };
    }
    try {
        if (fileIsTextual(file.type)) {
            const content = await readFileAsText(file);
            return { ...base, content, extractionStatus: 'ok' };
        }
        // Try UTF-8 decode as fallback
        const content = await readFileAsUtf8(file);
        return { ...base, content, extractionStatus: 'ok' };
    }
    catch (err) {
        return { ...base, extractionStatus: 'error', note: err.message };
    }
};
export const summarizeAttachments = (attachments, maxFiles = 3, maxCharsPerFile = 800) => {
    const top = attachments
        .filter((a) => a.content && a.extractionStatus === 'ok' && a.contentType !== 'application/pdf')
        .slice(0, maxFiles);
    if (!top.length)
        return '';
    const parts = top.map((a) => {
        const snippet = (a.content || '').slice(0, maxCharsPerFile);
        return `${a.name || 'file'} (type: ${a.contentType || a.type || 'unknown'}):\n${snippet}`;
    });
    return parts.join('\n---\n');
};
