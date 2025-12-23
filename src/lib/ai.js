import { randomId } from './task-utils';
import { apiCall } from './api-client.js';

const apiSplit = '/api/ai/split';
const apiChat = '/api/ai/chat';
export const generateSubtasks = async ({ task, conversation, globalInstruction, modelId, userId }) => {
    const res = await apiCall(apiSplit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, conversation, globalInstruction, modelId, userId })
    });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to reach AI service');
    }
    const data = await res.json();
    const items = data.items || [];
    return items.map((item) => ({
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
export const chatWithPlanner = async (prompt, tasks, globalInstruction, selectedTaskId, modelId, userId) => {
    const res = await apiCall(apiChat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tasks, globalInstruction, selectedTaskId, modelId, userId })
    });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to reach AI service');
    }
    const data = await res.json();
    const content = data.content || '';
    const attachmentsUsed = data.attachmentsUsed || [];
    return {
        id: randomId(),
        role: 'ai',
        content,
        attachmentsUsed,
        createdAt: new Date().toISOString()
    };
};
