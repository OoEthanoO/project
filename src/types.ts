export type Attachment = {
  id: string;
  name: string;
  size?: number;
  type?: string;
  contentType?: string;
  content?: string;
  dataUrl?: string;
  extractionStatus?: 'ok' | 'unsupported' | 'too-large' | 'error';
  note?: string;
};

export type TaskNode = {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
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
};
