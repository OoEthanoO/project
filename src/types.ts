export type Attachment = {
  id: string;
  name: string;
  size?: number;
  type?: string;
  contentType?: string;
  content?: string;
  dataUrl?: string;
  r2Key?: string; // Cloudflare R2 storage key for persistent files
  extractionStatus?: 'ok' | 'unsupported' | 'too-large' | 'error' | 'pending';
  note?: string;
  // Local-only reference to the selected File for deferred upload
  file?: File;
};

export type TaskNode = {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  startDate?: string;
  attachments: Attachment[];
  children: TaskNode[];
  parentId?: string | null;
  status?: 'open' | 'in-progress' | 'done';
  createdBy: 'user' | 'ai';
  createdAt?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  createdAt?: string;
  attachmentsUsed?: string[];
};

export type PlannerConfig = {
  globalInstruction: string;
  modelId?: string;
};

export type AccountUser = {
  id: string;
  email: string;
  name: string;
  token: string;
  balanceCents?: number;
  emailVerified?: boolean;
};
