import { ChatMessage, PlannerConfig, TaskNode } from '../types';

export type PersistedState = {
  tasks: TaskNode[];
  chat: ChatMessage[];
  config: PlannerConfig;
  selectedTaskId: string | null;
};

const handle = async (res: Response) => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Request failed');
  }
  return res.json();
};

export const fetchState = async (userId: string): Promise<PersistedState> => {
  const res = await fetch(`/api/state?userId=${encodeURIComponent(userId)}`);
  const data = await handle(res);
  return {
    tasks: data.tasks || [],
    chat: data.chat || [],
    config: {
      globalInstruction: data.config?.globalInstruction || '',
      modelId: data.config?.modelId
    },
    selectedTaskId: data.selectedTaskId ?? null
  };
};

export const saveState = async (userId: string, state: PersistedState): Promise<PersistedState> => {
  const res = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...state })
  });
  const data = await handle(res);
  return {
    tasks: data.tasks || [],
    chat: data.chat || [],
    config: {
      globalInstruction: data.config?.globalInstruction || '',
      modelId: data.config?.modelId
    },
    selectedTaskId: data.selectedTaskId ?? null
  };
};
