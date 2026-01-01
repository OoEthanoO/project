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

/**
 * Collect all R2 keys from a task and its children
 * @param {Object} task - Task node
 * @returns {string[]} Array of R2 keys
 */
export const collectR2Keys = (task) => {
    const keys = (task.attachments || [])
        .filter(a => a.r2Key)
        .map(a => a.r2Key);
    
    const childKeys = (task.children || []).flatMap(collectR2Keys);
    
    return [...keys, ...childKeys];
};

/**
 * Find a task and collect all its R2 keys before removal
 * @param {Object[]} tasks - Task list
 * @param {string} id - Task ID to remove
 * @returns {string[]} Array of R2 keys to delete
 */
export const getR2KeysForTask = (tasks, id) => {
    const task = findTask(tasks, id);
    return task ? collectR2Keys(task) : [];
};

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

/**
 * Move a task to the top of its level
 * @param {Object[]} tasks - Task list
 * @param {string} targetId - Task ID to move
 * @returns {Object[]} New task list with task moved to top
 */
export const moveTaskToTop = (tasks, targetId) => {
    const move = (list) => {
        const idx = list.findIndex((t) => t.id === targetId);
        if (idx === -1)
            return list.map((t) => withChildren(t, move(t.children || [])));
        if (idx === 0)
            return list;
        const newList = [...list];
        const task = newList.splice(idx, 1)[0];
        newList.unshift(task);
        return newList;
    };
    return move(tasks || []);
};

/**
 * Move a task to the bottom of its level
 * @param {Object[]} tasks - Task list
 * @param {string} targetId - Task ID to move
 * @returns {Object[]} New task list with task moved to bottom
 */
export const moveTaskToBottom = (tasks, targetId) => {
    const move = (list) => {
        const idx = list.findIndex((t) => t.id === targetId);
        if (idx === -1)
            return list.map((t) => withChildren(t, move(t.children || [])));
        if (idx === list.length - 1)
            return list;
        const newList = [...list];
        const task = newList.splice(idx, 1)[0];
        newList.push(task);
        return newList;
    };
    return move(tasks || []);
};

export const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
/**
 * Collect all parent tasks up the chain from a given task ID
 * Returns array of ancestors from immediate parent to root, in order
 * @param {Object[]} tasks - Root task list
 * @param {string} id - Task ID to find ancestors for
 * @returns {Object[]} Array of ancestor tasks (empty if task not found or is root)
 */
export const getAncestors = (tasks, id) => {
  const ancestors = [];
  
  const traverse = (list, parentTask = null) => {
    for (const task of list || []) {
      if (task.id === id && parentTask) {
        // Found the task; now collect all parents up the chain
        let current = parentTask;
        while (current) {
          ancestors.unshift(current);
          current = current.parentTask || null;
        }
        return true;
      }
      // Mark children with their parent for traversal
      const childrenWithParent = (task.children || []).map(c => ({ ...c, parentTask: task }));
      if (traverse(childrenWithParent, task)) return true;
    }
    return false;
  };
  
  traverse(tasks);
  return ancestors;
};

const getStatusFromChildren = (children) => {
  if (!children || children.length === 0) return null;
  let allOpen = true;
  let allDone = true;
  for (const child of children) {
    const status = child.status || 'open';
    if (status !== 'open') allOpen = false;
    if (status !== 'done') allDone = false;
  }
  if (allOpen) return 'open';
  if (allDone) return 'done';
  return 'in-progress';
};

export const updateAncestorStatuses = (tasks, id) => {
  const ancestors = getAncestors(tasks, id);
  if (!ancestors.length) return tasks;
  let next = tasks;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = ancestors[i];
    const current = findTask(next, ancestor.id);
    if (!current) continue;
    const derivedStatus = getStatusFromChildren(current.children || []);
    if (!derivedStatus || current.status === derivedStatus) continue;
    next = updateTask(next, ancestor.id, (t) => ({
      ...t,
      status: derivedStatus
    }));
  }
  return next;
};
