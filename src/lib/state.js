import { apiCall } from './api-client.js';

const handle = async (res) => {
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Request failed');
    }
    return res.json();
};
export const fetchState = async (userId) => {
    const res = await apiCall(`/api/state?userId=${encodeURIComponent(userId)}`);
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
export const saveState = async (userId, state) => {
    // Strip dataUrl from attachments to save space (keep r2Key and metadata)
    const stripDataUrls = (tasks) => {
        return tasks.map(task => ({
            ...task,
            attachments: (task.attachments || []).map(a => {
                const { dataUrl, ...rest } = a;
                return rest; // Keep r2Key, name, type, content, etc. but remove dataUrl
            }),
            children: stripDataUrls(task.children || [])
        }));
    };
    
    const cleanedState = {
        ...state,
        tasks: stripDataUrls(state.tasks || [])
    };
    
    const res = await apiCall('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...cleanedState })
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
