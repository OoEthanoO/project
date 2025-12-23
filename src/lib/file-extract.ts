import { Attachment } from '../types';
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

const fileIsTextual = (type: string) =>
  TEXT_TYPES.includes(type) || type.startsWith('text/') || type.endsWith('+json') || type.endsWith('+xml');

const MAX_INLINE_BYTES = 200_000; // 200 KB to avoid localStorage blowups
const MAX_IMAGE_BYTES = 2_000_000; // 2 MB for base64 images
const MAX_PDF_BYTES = 4_000_000; // 4 MB for PDF base64

const readFileAsText = async (file: File): Promise<string> => {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve((reader.result as string) || '');
    reader.readAsText(file);
  });
};

const readFileAsUtf8 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  return UTF8_DECODER.decode(buffer);
};

const readFileAsDataUrl = async (file: File): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve((reader.result as string) || '');
    reader.readAsDataURL(file);
  });
};

export const extractAttachment = async (file: File): Promise<Attachment> => {
  const base: Attachment = {
    id: randomId(),
    name: file.name,
    size: file.size,
    type: file.type,
    contentType: file.type
  };

  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ...base, extractionStatus: 'too-large', note: 'Image too large to inline' };
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      return { ...base, dataUrl, extractionStatus: 'ok' };
    } catch (err) {
      return { ...base, extractionStatus: 'error', note: (err as Error).message };
    }
  }

  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) {
      return { ...base, extractionStatus: 'too-large', note: 'PDF too large to inline' };
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      return { ...base, dataUrl, extractionStatus: 'ok' };
    } catch (err) {
      return { ...base, extractionStatus: 'error', note: (err as Error).message };
    }
  }

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
  } catch (err) {
    return { ...base, extractionStatus: 'error', note: (err as Error).message };
  }
};

export const summarizeAttachments = (attachments: Attachment[], maxFiles = 3, maxCharsPerFile = 800) => {
  const top = attachments
    .filter((a) => a.content && a.extractionStatus === 'ok' && a.contentType !== 'application/pdf')
    .slice(0, maxFiles);
  if (!top.length) return '';
  const parts = top.map((a) => {
    const snippet = (a.content || '').slice(0, maxCharsPerFile);
    return `${a.name || 'file'} (type: ${a.contentType || a.type || 'unknown'}):\n${snippet}`;
  });
  return parts.join('\n---\n');
};
