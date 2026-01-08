import { randomId } from './task-utils';
const TASKS_KEY = 'planner.tasks';
const CHAT_KEY = 'planner.chat';
const CONFIG_KEY = 'planner.config';
const SELECTED_KEY = 'planner.selectedTask';
const safeParse = (value, fallback) => {
    if (!value)
        return fallback;
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
};
const normalizeTask = (task) => ({
    ...task,
    id: task.id || randomId(),
    title: task.title || '(untitled task)',
    createdBy: task.createdBy ?? 'user',
    attachments: (task.attachments ?? []).map((a) => ({
        ...a,
        id: a.id || randomId(),
        name: a.name || 'attachment',
        content: a.content,
        dataUrl: a.dataUrl,
        extractionStatus: a.extractionStatus,
        type: a.type,
        contentType: a.contentType ?? a.type
    })),
    children: (task.children || []).map((c) => normalizeTask(c))
});
export const loadTasks = () => {
    try {
        const raw = safeParse(localStorage.getItem(TASKS_KEY), []);
        if (!Array.isArray(raw))
            return [];
        return raw
            .filter((t) => t && typeof t === 'object')
            .map(normalizeTask);
    }
    catch {
        return [];
    }
};
export const saveTasks = (tasks) => {
    try {
        localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    }
    catch {
        // best-effort; ignore storage failures so UI doesn't crash
    }
};
export const loadChat = () => safeParse(localStorage.getItem(CHAT_KEY), []);
export const saveChat = (messages) => {
    try {
        localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
    }
    catch {
        // ignore storage failures
    }
};
export const loadConfig = () => {
    const cfg = safeParse(localStorage.getItem(CONFIG_KEY), {});
    return {
        globalInstruction: cfg.globalInstruction || '',
        modelId: cfg.modelId,
        webSearchEnabled: cfg.webSearchEnabled
    };
};
export const saveConfig = (config) => {
    try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
    catch {
        // ignore storage failures
    }
};
export const loadSelectedTask = () => safeParse(localStorage.getItem(SELECTED_KEY), null);
export const saveSelectedTask = (id) => {
    try {
        if (id) {
            localStorage.setItem(SELECTED_KEY, JSON.stringify(id));
        }
        else {
            localStorage.removeItem(SELECTED_KEY);
        }
    }
    catch {
        // ignore storage failures
    }
};
// Future-ready: replace the above with API calls while keeping App.tsx usage stable.
