import { useState, MouseEvent, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Attachment, TaskNode, WorkDay } from '../types';
import TaskForm from './TaskForm';
import AttachmentList from './AttachmentList';
import { extractAttachment } from '../lib/file-extract';
import { apiCall } from '../lib/api-client.js';
import WorkDaysPicker from './WorkDaysPicker';
import { formatWorkDays } from '../lib/work-days';

type Props = {
  tasks: TaskNode[];
  onSplit: (id: string) => void;
  onAbortSplit?: (id: string) => void;
  onAddSubtask: (subtask: TaskNode) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  onReorder: (tasks: TaskNode[]) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  collapsedIds?: Set<string>;
  onToggleCollapsed?: (id: string) => void;
  highlightedTaskId?: string | null;
  userId?: string;
  todayUtc?: number;
  onboardingSplitTaskId?: string | null;
  onboardingShowSplit?: boolean;
  onClearIncompleteSubtasks?: (parentId: string) => void;
};

const copyTextToClipboard = async (text: string) => {
  if (!text) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (err) {
    console.warn('Clipboard API failed, falling back to execCommand.', err);
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
};

const uploadPendingAttachments = async (attachments: Attachment[], userId?: string): Promise<Attachment[]> => {
  if (!attachments.length) return attachments;
  return Promise.all(
    attachments.map(async (a): Promise<Attachment> => {
      if (a.extractionStatus !== 'pending' || !a.file) return a;
      if (!userId) {
        return { ...a, extractionStatus: 'error', note: 'Login required for file uploads' };
      }
      try {
        const urlResponse = await apiCall('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: a.name,
            contentType: a.contentType || a.type || 'application/octet-stream',
            userId
          })
        });
        if (!urlResponse.ok) {
          const error = await urlResponse.text();
          return { ...a, extractionStatus: 'error', note: `Upload failed: ${error}` };
        }
        const { uploadUrl, key } = await urlResponse.json();
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': a.contentType || a.type || 'application/octet-stream' },
          body: a.file as any
        });
        if (!putRes.ok) {
          const error = await putRes.text();
          return { ...a, extractionStatus: 'error', note: `R2 upload failed: ${error}` };
        }
        return { ...a, r2Key: key, extractionStatus: 'ok', file: undefined };
      } catch (err: any) {
        return { ...a, extractionStatus: 'error', note: err?.message || 'Upload error' };
      }
    })
  );
};

const TaskTree = ({
  tasks,
  onSplit,
  onAbortSplit,
  onAddSubtask,
  onDelete,
  onUpdate,
  onReorder,
  planningIds = new Set(),
  onEditModeChange,
  collapsedIds = new Set(),
  onToggleCollapsed,
  highlightedTaskId,
  userId,
  todayUtc,
  onboardingSplitTaskId,
  onboardingShowSplit,
  onClearIncompleteSubtasks
}: Props) => {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  
  const safeTasks = tasks || [];
  return (
    <div className="task-list">
      {safeTasks.map((task, index) => (
        <TaskNodeView
          key={task.id || `root-${task.title}`}
          task={task}
          depth={0}
          index={index}
          parentId={null}
          onSplit={onSplit}
          onAbortSplit={onAbortSplit}
          onAddSubtask={onAddSubtask}
          onDelete={onDelete}
          onUpdate={onUpdate}
          onReorder={onReorder}
          planningIds={planningIds}
          onEditModeChange={onEditModeChange}
          collapsedIds={collapsedIds}
          onToggleCollapsed={onToggleCollapsed}
          highlightedTaskId={highlightedTaskId}
          userId={userId}
          todayUtc={todayUtc}
          onboardingSplitTaskId={onboardingSplitTaskId}
          onboardingShowSplit={onboardingShowSplit}
          onClearIncompleteSubtasks={onClearIncompleteSubtasks}
          draggedTaskId={draggedTaskId}
          setDraggedTaskId={setDraggedTaskId}
          dragOverTaskId={dragOverTaskId}
          setDragOverTaskId={setDragOverTaskId}
          allTasks={tasks}
        />
      ))}
    </div>
  );
};

const isDueTodayOrPast = (dueDate?: string, todayUtc?: number) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? new Date(y, m - 1, d).getTime() : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  if (typeof todayUtc !== 'number') {
    const now = new Date();
    const fallbackUtc = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return due <= fallbackUtc;
  }
  return due <= todayUtc;
};

const resolveTodayUtc = (todayUtc?: number) => {
  if (typeof todayUtc === 'number') return todayUtc;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const isDueOnOrBefore = (dueDate?: string, compareUtc?: number) => {
  if (!dueDate || typeof compareUtc !== 'number') return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? new Date(y, m - 1, d).getTime() : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  return due <= compareUtc;
};

const hasOpenSubtaskDueSoon = (task: TaskNode, compareUtc?: number): boolean => {
  const children = task.children || [];
  for (const child of children) {
    if (child.status !== 'done' && isDueOnOrBefore(child.dueDate, compareUtc)) return true;
    if (hasOpenSubtaskDueSoon(child, compareUtc)) return true;
  }
  return false;
};

const isActiveStatus = (status?: TaskNode['status']) => (status ?? 'open') !== 'done';

const TaskNodeView = ({
  task,
  depth,
  index,
  parentId,
  onSplit,
  onAbortSplit,
  onAddSubtask,
  onDelete,
  onUpdate,
  onReorder,
  planningIds,
  onEditModeChange,
  collapsedIds,
  onToggleCollapsed,
  highlightedTaskId,
  userId,
  draggedTaskId,
  setDraggedTaskId,
  dragOverTaskId,
  setDragOverTaskId,
  allTasks,
  onboardingSplitTaskId,
  onboardingShowSplit,
  onClearIncompleteSubtasks,
  todayUtc
}: {
  task: TaskNode;
  depth: number;
  index: number;
  parentId: string | null;
  onSplit: (id: string) => void;
  onAbortSplit?: (id: string) => void;
  onAddSubtask: (subtask: TaskNode) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  onReorder: (tasks: TaskNode[]) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  collapsedIds?: Set<string>;
  onToggleCollapsed?: (id: string) => void;
  highlightedTaskId?: string | null;
  userId?: string;
  draggedTaskId: string | null;
  setDraggedTaskId: (id: string | null) => void;
  dragOverTaskId: string | null;
  setDragOverTaskId: (id: string | null) => void;
  allTasks: TaskNode[];
  onboardingSplitTaskId?: string | null;
  onboardingShowSplit?: boolean;
  onClearIncompleteSubtasks?: (parentId: string) => void;
  todayUtc?: number;
}) => {
  const [showSubForm, setShowSubForm] = useState(false);
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [copySubmenuOpen, setCopySubmenuOpen] = useState(false);
  const copySubmenuCloseTimeoutRef = useRef<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const isStartAfterDue = task.startDate && task.dueDate && task.startDate >= task.dueDate;
  const canSplit = !isDueTodayOrPast(task.dueDate, todayUtc) && !isStartAfterDue;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [startDate, setStartDate] = useState(task.startDate || '');
  const [description, setDescription] = useState(task.description || '');
  const [workDays, setWorkDays] = useState<WorkDay[]>(task.workDays || []);
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments || []);
  const [attachError, setAttachError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const isDone = task.status === 'done';
  const isCollapsed = collapsedIds?.has(task.id) ?? false;
  const isDragging = draggedTaskId === task.id;
  const isDragOver = dragOverTaskId === task.id;
  const hasChildren = (task.children ?? []).length > 0;
  const showMenuButton = !isMobile && !editing;
  const isOnboardingSplitTarget = onboardingSplitTaskId === task.id;
  const isSplitting = planningIds?.has(task.id);
  const isHighlighted = highlightedTaskId === task.id;
  const titleText = task.title?.trim() ?? '';
  const hasTitle = titleText.length > 0;
  const descriptionText = task.description?.trim() ?? '';
  const hasDescription = descriptionText.length > 0;
  const resolvedTodayUtc = resolveTodayUtc(todayUtc);
  const todayLocal = new Date(resolvedTodayUtc);
  const dueSoonUtc = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate() + 1).getTime();
  const hasDueSoonSelf = !isDone && isDueOnOrBefore(task.dueDate, dueSoonUtc);
  const hasDueSoonSubtask = hasOpenSubtaskDueSoon(task, dueSoonUtc);
  const hasDueSoonIndicator = hasDueSoonSelf || hasDueSoonSubtask;
  const hasIncompleteSubtasks = (task.children || []).some((child) => isActiveStatus(child.status));
  const splitDisabledReason = !canSplit
    ? 'Due today or overdue; adjust due date before splitting.'
    : undefined;

  console.log('TaskNodeView render - task:', task.id, 'editing:', editing);

  // Track previous editing state to only notify parent when it actually changes
  const prevEditingRef = useRef<boolean>(editing);
  const isFirstRenderRef = useRef(true);
  
  useEffect(() => {
    console.log('TaskNodeView MOUNTED for task:', task.id);
    return () => {
      console.log('TaskNodeView UNMOUNTED for task:', task.id);
    };
  }, [task.id]);
  
  useEffect(() => {
    // Skip calling onEditModeChange on the very first render
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevEditingRef.current = editing;
      return;
    }
    if (prevEditingRef.current !== editing) {
      console.log('Calling onEditModeChange:', editing, 'prev was:', prevEditingRef.current);
      prevEditingRef.current = editing;
      // Use setTimeout to defer the callback until after React finishes the current render cycle
      setTimeout(() => {
        onEditModeChange?.(editing);
      }, 0);
    }
  }, [editing, onEditModeChange]);

  // Sync form values when entering edit mode or when task props change
  useEffect(() => {
    setTitle(task.title);
    setDueDate(task.dueDate || '');
    setStartDate(task.startDate || '');
    setDescription(task.description || '');
    setWorkDays(task.workDays || []);
    setAttachments(task.attachments || []);
  }, [task.title, task.dueDate, task.startDate, task.description, task.workDays, task.attachments]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu')) {
        setContextMenu(null);
        setCopySubmenuOpen(false);
      }
    };
    if (contextMenu) {
      // Use setTimeout to avoid closing menu on the same click that opened it
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu && copySubmenuOpen) {
      setCopySubmenuOpen(false);
    }
    if (!contextMenu && copySubmenuCloseTimeoutRef.current) {
      window.clearTimeout(copySubmenuCloseTimeoutRef.current);
      copySubmenuCloseTimeoutRef.current = null;
    }
  }, [contextMenu, copySubmenuOpen]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    if (!userId) {
      setAttachError('You must be logged in to upload files.');
      return;
    }
    const allowed = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'];
    const incoming = Array.from(files);
    const disallowed = incoming.filter((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      return !allowed.includes(ext);
    });
    if (disallowed.length) {
      setAttachError(
        'Only PDF or image files (jpg, jpeg, png, webp, gif) are supported. Convert other files to PDF or attach via URL.'
      );
      return;
    }
    const tooLarge = incoming.filter((f) => f.size > 10 * 1024 * 1024);
    if (tooLarge.length) {
      setAttachError('Files must be 10 MB or smaller. Please compress or split the PDF.');
      return;
    }
    setAttachError('');
    const extracted = await Promise.all(incoming.map((file) => extractAttachment(file, userId)));
    setAttachments((prev) => [...prev, ...(extracted as Attachment[])]);
  };

  const handleSave = async () => {
    setIsUploading(true);
    const uploaded = await uploadPendingAttachments(attachments, userId);
    setIsUploading(false);
    onUpdate(task.id, {
      title: title.trim() || '(untitled)',
      dueDate: dueDate || undefined,
      startDate: startDate || undefined,
      description: description.trim(),
      workDays: workDays.length ? workDays : undefined,
      attachments: uploaded
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setTitle(task.title);
    setDueDate(task.dueDate || '');
    setStartDate(task.startDate || '');
    setDescription(task.description || '');
    setWorkDays(task.workDays || []);
    setAttachments(task.attachments || []);
    setAttachError('');
    setEditing(false);
  };

  useEffect(() => {
    if (!isOnboardingSplitTarget) return;
    if (!onboardingShowSplit) {
      if (contextMenu) setContextMenu(null);
      if (showMobileModal) setShowMobileModal(false);
      return;
    }
    if (isMobile) {
      if (!showMobileModal) setShowMobileModal(true);
      return;
    }
    if (!contextMenu) {
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (rect) {
        setContextMenu({ x: rect.left, y: rect.bottom + 6 });
      }
    }
  }, [isOnboardingSplitTarget, onboardingShowSplit, isMobile, contextMenu, showMobileModal]);

  const handleMenuToggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (editing) return;
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 6 });
  };

  const handleCopyTitle = () => {
    if (!hasTitle) return;
    void copyTextToClipboard(titleText);
  };

  const handleCopyDescription = () => {
    if (!hasDescription) return;
    void copyTextToClipboard(descriptionText);
  };

  const handleCopyBoth = () => {
    if (!hasTitle && !hasDescription) return;
    const combined = hasTitle
      ? `${titleText}${hasDescription ? `. ${descriptionText}` : ''}`
      : descriptionText;
    void copyTextToClipboard(combined);
  };

  const handleClearIncompleteChildren = () => {
    if (onClearIncompleteSubtasks) {
      onClearIncompleteSubtasks(task.id);
      return;
    }
    onUpdate(task.id, { children: (task.children || []).filter((c) => !isActiveStatus(c.status)) });
  };

  const openCopySubmenu = () => {
    if (copySubmenuCloseTimeoutRef.current) {
      window.clearTimeout(copySubmenuCloseTimeoutRef.current);
      copySubmenuCloseTimeoutRef.current = null;
    }
    setCopySubmenuOpen(true);
  };

  const scheduleCloseCopySubmenu = () => {
    if (copySubmenuCloseTimeoutRef.current) {
      window.clearTimeout(copySubmenuCloseTimeoutRef.current);
    }
    copySubmenuCloseTimeoutRef.current = window.setTimeout(() => {
      setCopySubmenuOpen(false);
      copySubmenuCloseTimeoutRef.current = null;
    }, 150);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedTaskId(task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedTaskId && draggedTaskId !== task.id) {
      setDragOverTaskId(task.id);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    if (dragOverTaskId === task.id) {
      setDragOverTaskId(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedTaskId || draggedTaskId === task.id) {
      setDraggedTaskId(null);
      setDragOverTaskId(null);
      return;
    }

    // Helper to find task and its parent
    const findTaskWithParent = (tasks: TaskNode[], targetId: string, parent: TaskNode | null = null): { task: TaskNode; parent: TaskNode | null; siblings: TaskNode[]; index: number } | null => {
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].id === targetId) {
          return { task: tasks[i], parent, siblings: tasks, index: i };
        }
        const found = findTaskWithParent(tasks[i].children || [], targetId, tasks[i]);
        if (found) return found;
      }
      return null;
    };

    const draggedInfo = findTaskWithParent(allTasks, draggedTaskId);
    const dropInfo = findTaskWithParent(allTasks, task.id);

    if (!draggedInfo || !dropInfo) {
      setDraggedTaskId(null);
      setDragOverTaskId(null);
      return;
    }

    // Check if they have the same parent (same level)
    const draggedParentId = draggedInfo.parent?.id || null;
    const dropParentId = dropInfo.parent?.id || null;

    if (draggedParentId !== dropParentId) {
      // Different parents, cannot reorder
      setDraggedTaskId(null);
      setDragOverTaskId(null);
      return;
    }

    // Reorder within the same parent
    const newSiblings = [...draggedInfo.siblings];
    const [removed] = newSiblings.splice(draggedInfo.index, 1);
    const newDropIndex = newSiblings.findIndex(t => t.id === task.id);
    // When dragging down, insert after the drop target; when dragging up, insert before
    const insertIndex = draggedInfo.index < dropInfo.index ? newDropIndex + 1 : newDropIndex;
    newSiblings.splice(insertIndex, 0, removed);

    // Update the task tree
    if (!draggedInfo.parent) {
      // Root level reorder
      onReorder(newSiblings);
    } else {
      // Subtask reorder - update parent's children
      onUpdate(draggedInfo.parent.id, { children: newSiblings });
    }

    setDraggedTaskId(null);
    setDragOverTaskId(null);
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverTaskId(null);
  };

  return (
    <div
      className={`task-card ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${isHighlighted ? 'tree-highlight' : ''}`}
      style={{ marginLeft: depth === 0 ? 0 : depth * 12 }}
      data-task-id={task.id}
      draggable={!editing && !isMobile}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (isMobile && !editing) {
          setShowMobileModal(true);
        }
      }}
      onContextMenu={(e) => {
        if (!isMobile) {
          e.preventDefault();
          e.stopPropagation();
          if (!editing) {
            setContextMenu({ x: e.clientX, y: e.clientY });
          }
        }
      }}
    >
      <div className="task-header">
        <div className="task-main-row">
          {editing ? (
            <>
              <button
                className={`task-status-toggle status-${task.status || 'open'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const isReverse = e.shiftKey;
                  const nextStatus = isReverse
                    ? task.status === 'open' ? 'done' : task.status === 'done' ? 'in-progress' : 'open'
                    : task.status === 'open' ? 'in-progress' : task.status === 'in-progress' ? 'done' : 'open';
                  onUpdate(task.id, { status: nextStatus });
                }}
                title="Click to cycle: open → in-progress → done → open. Shift+click to reverse."
              >
                {task.status === 'done' ? '✓' : task.status === 'in-progress' ? '◐' : '○'}
              </button>
              <div className="form-row">
                <div>
                  <label className="muted">Title</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
                </div>
                <div>
                  <label className="muted">Due date</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className={`date-input ${dueDate ? '' : 'empty'}`}
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                    {dueDate && (
                      <button type="button" className="subtle" onClick={() => setDueDate('')}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="muted">Start date</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className={`date-input ${startDate ? '' : 'empty'}`}
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                    {startDate && (
                      <button type="button" className="subtle" onClick={() => setStartDate('')}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="task-title-stack">
              <div className="task-title-row">
                <button
                  className={`task-status-toggle status-${task.status || 'open'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const isReverse = e.shiftKey;
                    const nextStatus = isReverse
                      ? task.status === 'open' ? 'done' : task.status === 'done' ? 'in-progress' : 'open'
                      : task.status === 'open' ? 'in-progress' : task.status === 'in-progress' ? 'done' : 'open';
                    onUpdate(task.id, { status: nextStatus });
                  }}
                  title="Click to cycle: open → in-progress → done → open. Shift+click to reverse."
                >
                  {task.status === 'done' ? '✓' : task.status === 'in-progress' ? '◐' : '○'}
                </button>
                <p className={`task-title ${isDone ? 'task-done' : ''}`} style={{ margin: 0 }}>{task.title}</p>
                {hasDueSoonIndicator && (
                  <span
                    className="due-soon-icon"
                    title={hasDueSoonSelf ? 'This task is due soon' : 'An open subtask is due soon'}
                  >
                    ⏰
                  </span>
                )}
                {task.createdBy === 'ai' && (
                  <span className="badge badge-ai" style={{ fontSize: 10, padding: '2px 6px' }}>
                    AI
                  </span>
                )}
                {isSplitting && (
                  <span className="badge badge-splitting" title="AI is splitting this task">
                    <span className="badge-splitting-spinner" aria-hidden="true" />
                    Splitting…
                  </span>
                )}
              </div>
              {task.dueDate && (
                <span className="muted task-due-date">
                  {task.startDate ? `${task.startDate} to ${task.dueDate}` : task.dueDate}
                </span>
              )}
              {task.workDays?.length ? (
                <span className="muted task-work-days">Work days: {formatWorkDays(task.workDays)}</span>
              ) : null}
            </div>
          )}
        </div>
        {(showMenuButton || hasChildren) && (
          <div className="task-header-actions">
            {showMenuButton && (
              <button
                type="button"
                className="secondary collapse-toggle menu-toggle"
                ref={menuButtonRef}
                style={{ 
                  padding: '4px 8px', 
                  minWidth: 0, 
                  width: 32, 
                  border: 'none',
                  boxShadow: 'none',
                  transition: 'box-shadow 180ms ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                onClick={handleMenuToggle}
                aria-label="Open task menu"
                title="Task actions"
              >
                ...
              </button>
            )}
            {hasChildren ? (
              <button
                type="button"
                className="secondary collapse-toggle"
                style={{ 
                  padding: '4px 8px', 
                  minWidth: 0, 
                  width: 32, 
                  border: 'none',
                  boxShadow: 'none',
                  transition: 'box-shadow 180ms ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapsed?.(task.id);
                }}
              >
                {isCollapsed ? '›' : '∨'}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          value={description}
          placeholder="Description"
          onChange={(e) => setDescription(e.target.value)}
          style={{ margin: '8px 0 6px' }}
        />
      ) : (
        task.description && <p className="muted" style={{ margin: '8px 0 6px' }}>{task.description}</p>
      )}
      {editing ? (
        <div style={{ margin: '8px 0 6px' }}>
          <label className="muted">Work days (optional)</label>
          <WorkDaysPicker value={workDays} onChange={(next) => setWorkDays(next ?? [])} />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
            AI subtasks will be due the day after each work day (ex: Tue work day to Wed due date).
          </p>
        </div>
      ) : null}
      {editing ? (
        <div style={{ margin: '8px 0 6px' }}>
          <label className="muted">Attachments</label>
          <input
            type="file"
            multiple
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
            Supported: PDF, JPG, JPEG, PNG, WEBP, GIF. Maximum 10 MB per file.
          </p>
          {attachError && (
            <p className="muted" style={{ color: '#f88', marginTop: 4 }}>
              {attachError}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="chips" style={{ marginTop: 6 }}>
              {attachments.map((a) => (
                <button
                  key={a.id}
                  className="chip"
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setAttachments((prev) => prev.filter((att) => att.id !== a.id));
                  }}
                >
                  {a.name} {a.extractionStatus && `(${a.extractionStatus})`} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <AttachmentList attachments={task.attachments} />
      )}
      <div className="task-actions" style={editing ? { display: 'flex' } : undefined}>
        {editing ? (
          <>
            <button className="primary" onClick={handleSave} disabled={isUploading}>
              {isUploading ? 'Saving...' : 'Save'}
            </button>
            <button className="secondary" onClick={handleCancel} disabled={isUploading}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              onClick={() => onSplit(task.id)}
              disabled={!canSplit || isDone || planningIds?.has(task.id)}
              title={splitDisabledReason}
            >
              {planningIds?.has(task.id) ? 'Planning…' : 'AI split'}
            </button>
            {isSplitting && onAbortSplit && (
              <button className="secondary" onClick={() => onAbortSplit(task.id)}>
                Abort split
              </button>
            )}
            <button className="secondary" onClick={() => setShowSubForm((v) => !v)}>
              {showSubForm ? 'Close form' : 'Add subtask'}
            </button>
            <button
              className="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button className="subtle" onClick={() => onDelete(task.id)}>
              Delete
            </button>
          </>
        )}
        {hasIncompleteSubtasks && (
          <button
            className="secondary"
            onClick={(e) => {
              e.stopPropagation();
              const ok = window.confirm('Clear all incomplete subtasks (open or in-progress) under this task? Completed subtasks stay.');
              if (!ok) return;
              handleClearIncompleteChildren();
            }}
          >
            Clear Incomplete Subtasks
          </button>
        )}
      </div>
      {showSubForm && (
        <div className="subtasks" style={{ marginTop: 12 }}>
          <TaskForm
            onSubmit={(newTask) => onAddSubtask(newTask)}
            parentId={task.id}
            onCancel={() => setShowSubForm(false)}
            userId={userId}
          />
        </div>
      )}
      {(task.children ?? []).length > 0 && !isCollapsed && (
        <div className="subtasks">
          {(task.children ?? []).map((child, idx) => (
            <TaskNodeView
              key={child.id || `${task.id}-child-${idx}`}
              task={child}
              depth={depth + 1}
              index={idx}
              parentId={task.id}
              onSplit={onSplit}
              onAddSubtask={onAddSubtask}
              onDelete={onDelete}
              onUpdate={onUpdate}
              onReorder={onReorder}
              planningIds={planningIds}
              onEditModeChange={onEditModeChange}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
              highlightedTaskId={highlightedTaskId}
              userId={userId}
              draggedTaskId={draggedTaskId}
              setDraggedTaskId={setDraggedTaskId}
              dragOverTaskId={dragOverTaskId}
              setDragOverTaskId={setDragOverTaskId}
              allTasks={allTasks}
              onboardingSplitTaskId={onboardingSplitTaskId}
              onboardingShowSplit={onboardingShowSplit}
              onClearIncompleteSubtasks={onClearIncompleteSubtasks}
            />
          ))}
        </div>
      )}
      
      {/* Mobile task detail modal */}
      {showMobileModal && isMobile && createPortal(
        <div className={`modal-backdrop ${onboardingShowSplit ? 'onboarding-docked' : ''}`} onClick={() => setShowMobileModal(false)}>
          <div className="modal mobile-task-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: 12 }}>
              <p className="task-title" style={{ fontSize: 16, marginBottom: 8 }}>{task.title}</p>
              {task.description && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{task.description}</p>}
              <div className="task-meta" style={{ marginBottom: 12 }}>
                {task.dueDate && <span className="badge">Due {task.dueDate}</span>}
                {task.startDate && <span className="badge">Start {task.startDate}</span>}
                {task.workDays?.length ? <span className="badge">Work days {formatWorkDays(task.workDays)}</span> : null}
                <button
                  className={`badge badge-status status-${task.status || 'open'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const isReverse = e.shiftKey;
                    const nextStatus = isReverse
                      ? task.status === 'open' ? 'done' : task.status === 'done' ? 'in-progress' : 'open'
                      : task.status === 'open' ? 'in-progress' : task.status === 'in-progress' ? 'done' : 'open';
                    onUpdate(task.id, { status: nextStatus });
                  }}
                >
                  {task.status === 'done' ? '✓ ' : task.status === 'in-progress' ? '⟳ ' : '○ '}
                  {task.status || 'open'}
                </button>
                <span className={`badge ${task.createdBy === 'ai' ? 'badge-ai' : 'badge-user'}`}>
                  {task.createdBy === 'ai' ? 'AI' : 'User'}
                </span>
              </div>
              <AttachmentList attachments={task.attachments} />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="primary"
                onClick={() => {
                  setShowMobileModal(false);
                  onSplit(task.id);
                }}
                disabled={!canSplit || isDone || planningIds?.has(task.id)}
                title={splitDisabledReason}
                data-onboarding={isOnboardingSplitTarget && onboardingShowSplit ? 'split-task' : undefined}
              >
                {planningIds?.has(task.id) ? 'Planning…' : 'AI split'}
              </button>
              {isSplitting && onAbortSplit && (
                <button
                  className="secondary"
                  onClick={() => {
                    setShowMobileModal(false);
                    onAbortSplit(task.id);
                  }}
                >
                  Abort split
                </button>
              )}
              <button
                className="secondary"
                onClick={() => {
                  setShowMobileModal(false);
                  handleCopyTitle();
                }}
                disabled={!hasTitle}
                title={!hasTitle ? 'No title to copy.' : 'Copy task name'}
              >
                Copy name
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setShowMobileModal(false);
                  handleCopyDescription();
                }}
                disabled={!hasDescription}
                title={!hasDescription ? 'No description to copy.' : 'Copy description'}
              >
                Copy description
              </button>
              <button 
                className="secondary" 
                onClick={() => {
                  setShowMobileModal(false);
                  setShowSubForm(true);
                }}
              >
                Add subtask
              </button>
              {editing ? (
                <>
                  <button
                    className="primary"
                    onClick={async () => {
                      await handleSave();
                      setShowMobileModal(false);
                    }}
                    disabled={isUploading}
                  >
                    {isUploading ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      handleCancel();
                      setShowMobileModal(false);
                    }}
                    disabled={isUploading}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button 
                  className="secondary" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMobileModal(false);
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              )}
              <button 
                className="secondary" 
                onClick={() => {
                  setShowMobileModal(false);
                  onDelete(task.id);
                }}
              >
                Delete
              </button>
              {hasIncompleteSubtasks && (
                <button
                  className="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    const ok = window.confirm('Clear all incomplete subtasks (open or in-progress) under this task? Completed subtasks stay.');
                    if (!ok) return;
                    setShowMobileModal(false);
                    handleClearIncompleteChildren();
                  }}
                >
                  Clear Incomplete Subtasks
                </button>
              )}
              <button className="secondary" onClick={() => setShowMobileModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {/* Desktop context menu */}
      {contextMenu && !isMobile && createPortal(
        <>
          <div
            className="context-menu-backdrop"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setContextMenu(null);
              setCopySubmenuOpen(false);
            }}
          />
          <div
            className="context-menu"
            style={{
              position: 'fixed',
              left: `${Math.min(contextMenu.x, window.innerWidth - 200)}px`,
              top: `${Math.min(contextMenu.y, window.innerHeight - 300)}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
          <button
            className="context-menu-item"
            onClick={() => {
              setContextMenu(null);
              onSplit(task.id);
            }}
            disabled={!canSplit || isDone || planningIds?.has(task.id)}
            title={splitDisabledReason}
            data-onboarding={isOnboardingSplitTarget && onboardingShowSplit ? 'split-task' : undefined}
          >
            {planningIds?.has(task.id) ? 'Planning…' : '🤖 AI split'}
          </button>
          {isSplitting && onAbortSplit && (
            <button
              className="context-menu-item"
              onClick={() => {
                setContextMenu(null);
                onAbortSplit(task.id);
              }}
            >
              ⛔ Abort split
            </button>
          )}
          <div
            className={`context-menu-item has-submenu ${copySubmenuOpen ? 'open' : ''}`}
            onMouseEnter={openCopySubmenu}
            onMouseLeave={scheduleCloseCopySubmenu}
            onClick={(e) => e.stopPropagation()}
            title="Copy task details"
          >
            📋 Copy
            {copySubmenuOpen && (
              <div
                className="context-submenu"
                onMouseEnter={openCopySubmenu}
                onMouseLeave={scheduleCloseCopySubmenu}
              >
                <button
                  className="context-submenu-item"
                  onClick={() => {
                    setContextMenu(null);
                    setCopySubmenuOpen(false);
                    handleCopyTitle();
                  }}
                  disabled={!hasTitle}
                  title={!hasTitle ? 'No title to copy.' : 'Copy task name'}
                >
                  Name
                </button>
                <button
                  className="context-submenu-item"
                  onClick={() => {
                    setContextMenu(null);
                    setCopySubmenuOpen(false);
                    handleCopyDescription();
                  }}
                  disabled={!hasDescription}
                  title={!hasDescription ? 'No description to copy.' : 'Copy description'}
                >
                  Description
                </button>
                <button
                  className="context-submenu-item"
                  onClick={() => {
                    setContextMenu(null);
                    setCopySubmenuOpen(false);
                    handleCopyBoth();
                  }}
                  disabled={!hasTitle && !hasDescription}
                  title={!hasTitle && !hasDescription ? 'Nothing to copy.' : 'Copy name and description'}
                >
                  Both
                </button>
              </div>
            )}
          </div>

          <button
            className="context-menu-item"
            onClick={() => {
              setContextMenu(null);
              setShowSubForm(true);
            }}
          >
            ➕ Add subtask
          </button>
          <button
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu(null);
              console.log('Edit clicked, current editing:', editing, 'task:', task.id);
              setEditing(true);
              console.log('After setEditing(true)');
            }}
          >
            ✏️ Edit
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              setContextMenu(null);
              onDelete(task.id);
            }}
          >
            🗑️ Delete
          </button>
          {hasIncompleteSubtasks && (
            <button
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                const ok = window.confirm('Clear all incomplete subtasks (open or in-progress) under this task? Completed subtasks stay.');
                if (!ok) return;
                setContextMenu(null);
                handleClearIncompleteChildren();
              }}
            >
              🧹 Clear Incomplete Subtasks
            </button>
          )}
        </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default TaskTree;
