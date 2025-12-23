import { ChatMessage, TaskNode } from '../types';
import { randomId } from './task-utils';

const apiSplit = '/api/ai/split';
const apiChat = '/api/ai/chat';

export const generateSubtasks = async ({
  task,
  ancestors,
  conversation,
  globalInstruction,
  modelId,
  userId
}: {
  task: TaskNode;
  ancestors?: TaskNode[];
  conversation: ChatMessage[];
  globalInstruction?: string;
  modelId?: string;
  userId: string;
}): Promise<TaskNode[]> => {
  const res = await fetch(apiSplit, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, ancestors, conversation, globalInstruction, modelId, userId })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to reach AI service');
  }
  const data = await res.json();
  const items = data.items || [];
  return items.map((item: any) => ({
    id: randomId(),
    title: item.title,
    description: item.description || `Auto-planned from "${task.title}".`,
    dueDate: item.dueDate || task.dueDate,
    attachments: [],
    children: [],
    parentId: task.id,
    status: 'open',
    createdBy: 'ai',
    createdAt: new Date().toISOString()
  }));
};

export const chatWithPlanner = async (
  prompt: string,
  tasks: TaskNode[],
  globalInstruction?: string,
  selectedTaskId?: string | null,
  modelId?: string,
  userId?: string
): Promise<ChatMessage> => {
  const res = await fetch(apiChat, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, tasks, globalInstruction, selectedTaskId, modelId, userId })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to reach AI service');
  }
  const data = await res.json();
  console.log('[client] Full API response:', data);
  const content = data.content || '';
  const attachmentsUsed: string[] = data.attachmentsUsed || [];
  console.log('[client] AI response data:', { content: content.slice(0, 50), attachmentsUsed });
  return {
    id: randomId(),
    role: 'ai',
    content,
    attachmentsUsed,
    createdAt: new Date().toISOString()
  };
};
