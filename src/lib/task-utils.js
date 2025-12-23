const withChildren = (task, children) => ({
    ...task,
    children,
    attachments: task.attachments ?? []
});
export const findTask = (tasks, id) => {
    for (const task of tasks || []) {
        if (task.id === id)
            return task;
        const found = findTask(task.children || [], id);
        if (found)
            return found;
    }
    return undefined;
};
export const updateTask = (tasks, id, updater) => (tasks || []).map((task) => task.id === id ? updater(task) : withChildren(task, updateTask(task.children || [], id, updater)));
export const addChild = (tasks, parentId, child) => {
    if (!parentId) {
        return [...(tasks || []), child];
    }
    return (tasks || []).map((task) => task.id === parentId
        ? { ...task, children: [...(task.children || []), child] }
        : withChildren(task, addChild(task.children || [], parentId, child)));
};
export const replaceChildren = (tasks, parentId, newChildren) => (tasks || []).map((task) => task.id === parentId
    ? { ...task, children: newChildren }
    : withChildren(task, replaceChildren(task.children || [], parentId, newChildren)));
export const removeTask = (tasks, id) => (tasks || [])
    .filter((task) => task.id !== id)
    .map((task) => withChildren(task, removeTask(task.children || [], id)));
export const removeAIGeneratedChildren = (tasks, parentId) => (tasks || []).map((task) => {
    if (task.id === parentId) {
        return { ...task, children: (task.children || []).filter((c) => c.createdBy !== 'ai') };
    }
    return withChildren(task, removeAIGeneratedChildren(task.children || [], parentId));
});
export const reorderWithinParent = (tasks, targetId, direction) => {
    const move = (list) => {
        const idx = list.findIndex((t) => t.id === targetId);
        if (idx === -1)
            return list.map((t) => withChildren(t, move(t.children || [])));
        const swapWith = direction === 'up' ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= list.length)
            return list;
        const newList = [...list];
        const temp = newList[idx];
        newList[idx] = newList[swapWith];
        newList[swapWith] = temp;
        return newList;
    };
    return move(tasks || []);
};
export const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
