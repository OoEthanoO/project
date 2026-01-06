import { randomId } from './task-utils';
import { apiCall } from './api-client.js';

const apiSplit = '/api/ai/split';
const apiChat = '/api/ai/chat';

/**
 * @typedef {import('../types').TaskNode} TaskNode
 * @typedef {import('../types').ChatMessage} ChatMessage
 */

/**
 * Generate subtasks for a given task using AI
 * @param {Object} params
 * @param {TaskNode} params.task - The task to split
 * @param {TaskNode[]} [params.ancestors] - Parent tasks for context
 * @param {ChatMessage[]} params.conversation - Chat history
 * @param {string} [params.globalInstruction] - Global instruction
 * @param {string} [params.modelId] - AI model ID
 * @param {string} params.userId - User ID
 * @param {string} [params.clientLocalDate] - Optional override for the client's local date (YYYY-MM-DD)
 * @returns {Promise<TaskNode[]>}
 */
export const generateSubtasks = async ({ task, ancestors, conversation, globalInstruction, modelId, userId, clientLocalDate }) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const now = new Date();
    const resolvedClientLocalDate = clientLocalDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const res = await apiCall(apiSplit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, ancestors, conversation, globalInstruction, modelId, userId, clientLocalDate: resolvedClientLocalDate, clientTimeZone: tz })
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
        // Keep model-provided dueDate; do not default to parent due to avoid collapsing schedule
        dueDate: item.dueDate ?? undefined,
        attachments: [],
        children: [],
        parentId: task.id,
        status: 'open',
        createdBy: 'ai',
        createdAt: new Date().toISOString()
    }));
};

/**
 * Chat with the AI planner
 * @param {string} prompt - User's message
 * @param {TaskNode[]} tasks - All tasks
 * @param {string} [globalInstruction] - Global instruction
 * @param {string | null} [selectedTaskId] - Selected task ID
 * @param {string} [modelId] - AI model ID
 * @param {string} [userId] - User ID
 * @param {string} [clientLocalDate] - Optional override for the client's local date (YYYY-MM-DD)
 * @returns {Promise<ChatMessage>}
 */
export const chatWithPlanner = async (prompt, tasks, globalInstruction, selectedTaskId, modelId, userId, clientLocalDate) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const now = new Date();
    const resolvedClientLocalDate = clientLocalDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const res = await apiCall(apiChat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tasks, globalInstruction, selectedTaskId, modelId, userId, clientLocalDate: resolvedClientLocalDate, clientTimeZone: tz })
    });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to reach AI service');
    }
    const data = await res.json();
    console.log('[client] Full API response:', data);
    const content = data.content || '';
    const attachmentsUsed = data.attachmentsUsed || [];
    console.log('[client] AI response data:', { content: content.slice(0, 50), attachmentsUsed });
    return {
        id: randomId(),
        role: 'ai',
        content,
        attachmentsUsed,
        createdAt: new Date().toISOString()
    };
};
