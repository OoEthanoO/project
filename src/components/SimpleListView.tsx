import { TaskNode, Attachment, WorkDay } from '../types';
import AttachmentList from './AttachmentList';
import { useEffect, useState, MouseEvent, useRef } from 'react';
import { createPortal } from 'react-dom';
import { extractAttachment } from '../lib/file-extract';
import { apiCall } from '../lib/api-client.js';
import WorkDaysPicker from './WorkDaysPicker';
import { formatWorkDays } from '../lib/work-days';

type Props = {
  tasks: TaskNode[];
  onSplit: (id: string) => void;
  onAbortSplit?: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  onShowInTree?: (id: string) => void;
  userId?: string;
  todayUtc?: number;
};

type FlatTask = TaskNode & { depth: number; order: number; parentTitle?: string; rootTitle: string; ancestry: string[] };

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

const flattenTasks = (
  tasks: TaskNode[],
  depth = 0,
  orderRef = { value: 0 },
  parentTitle?: string,
  ancestry: string[] = [],
  rootTitle?: string
): FlatTask[] => {
  return tasks.flatMap((t) => {
    const currentOrder = orderRef.value++;
    const nextAncestry = [...ancestry, t.id];
    const normalizedTitle = t.title || '(untitled task)';
    const nextRootTitle = rootTitle ?? normalizedTitle;
    const self: FlatTask = {
      ...t,
      parentId: t.parentId,
      title: normalizedTitle,
      depth,
      order: currentOrder,
      parentTitle,
      rootTitle: nextRootTitle,
      ancestry: nextAncestry
    };
    const children = flattenTasks(t.children || [], depth + 1, orderRef, normalizedTitle, nextAncestry, nextRootTitle);
    return [self, ...children];
  });
};

const compareByLowestCommonAncestor = (a: FlatTask, b: FlatTask, taskById: Map<string, FlatTask>) => {
  const pathA = a.ancestry;
  const pathB = b.ancestry;
  const minLength = Math.min(pathA.length, pathB.length);
  let idx = 0;
  while (idx < minLength && pathA[idx] === pathB[idx]) {
    idx += 1;
  }
  if (idx === 0 || idx >= minLength) return null;
  const aBranch = taskById.get(pathA[idx]);
  const bBranch = taskById.get(pathB[idx]);
  if (!aBranch || !bBranch) return null;
  if (aBranch.order === bBranch.order) return null;
  return aBranch.order - bBranch.order;
};

const compareAssociatedDueDate = (a: FlatTask, b: FlatTask, taskById: Map<string, FlatTask>) => {
  const rootA = taskById.get(a.ancestry[0]);
  const rootB = taskById.get(b.ancestry[0]);
  const dueA = rootA?.dueDate;
  const dueB = rootB?.dueDate;
  if (!dueA && !dueB) return 0;
  if (!dueA) return 1;
  if (!dueB) return -1;
  return dueA.localeCompare(dueB);
};

const compareRootPlacements = (a: FlatTask, b: FlatTask, taskById: Map<string, FlatTask>) => {
  const minLength = Math.min(a.ancestry.length, b.ancestry.length);
  for (let i = 0; i < minLength; i += 1) {
    const taskA = taskById.get(a.ancestry[i]);
    const taskB = taskById.get(b.ancestry[i]);
    if (!taskA || !taskB) return null;
    if (taskA.order !== taskB.order) return taskA.order - taskB.order;
  }
  return null;
};

const compareTasks = (taskById: Map<string, FlatTask>) => (a: FlatTask, b: FlatTask) => {
  if (!a.dueDate && !b.dueDate) {
    // No due date: preserve tree order
    return a.order - b.order;
  }
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  const dueCmp = a.dueDate.localeCompare(b.dueDate);
  if (dueCmp !== 0) return dueCmp;
  // same due date: compare associated (root) due date
  const associatedDueCmp = compareAssociatedDueDate(a, b, taskById);
  if (associatedDueCmp !== 0) return associatedDueCmp;
  // same associated due date: compare root placements in the tree
  const rootPlacementCmp = compareRootPlacements(a, b, taskById);
  if (rootPlacementCmp !== null) return rootPlacementCmp;
  // when ancestry runs out or ties, deeper depth first
  if (a.depth !== b.depth) return b.depth - a.depth;
  // final fallback: preserve tree order
  return a.order - b.order;
};

const isDueBeforeToday = (dueDate?: string, todayUtc?: number) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? new Date(y, m - 1, d).getTime() : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  if (typeof todayUtc !== 'number') {
    const now = new Date();
    const fallbackUtc = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return due < fallbackUtc;
  }
  return due < todayUtc;
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

const SimpleListView = ({ tasks, onSplit, onAbortSplit, onDelete, onUpdate, planningIds = new Set(), onEditModeChange, onShowInTree, userId, todayUtc }: Props) => {
  const flat = flattenTasks(tasks || []);
  const taskById = new Map(flat.map((task) => [task.id, task]));
  const taskComparator = compareTasks(taskById);
  const openAndProgress = flat.filter((t) => t.status !== 'done').sort(taskComparator);
  const completed = flat.filter((t) => t.status === 'done').sort((a, b) => -taskComparator(a, b));
  const sorted = [...openAndProgress, ...completed];

  return (
    <div className="task-list">
      {sorted.map((task) => (
        <ListItem
          key={task.id}
          task={task}
          onSplit={onSplit}
          onAbortSplit={onAbortSplit}
          onDelete={onDelete}
          onUpdate={onUpdate}
          planningIds={planningIds}
          onEditModeChange={onEditModeChange}
          onShowInTree={onShowInTree}
          userId={userId}
          todayUtc={todayUtc}
        />
      ))}
    </div>
  );
};

const ListItem = ({
  task,
  onSplit,
  onAbortSplit,
  onDelete,
  onUpdate,
  planningIds,
  onEditModeChange,
  onShowInTree,
  userId,
  todayUtc
}: {
  task: FlatTask;
  onSplit: (id: string) => void;
  onAbortSplit?: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  onShowInTree?: (id: string) => void;
  userId?: string;
  todayUtc?: number;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [startDate, setStartDate] = useState(task.startDate || '');
  const [description, setDescription] = useState(task.description || '');
  const [workDays, setWorkDays] = useState<WorkDay[]>(task.workDays || []);
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments || []);
  const [attachError, setAttachError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [copySubmenuOpen, setCopySubmenuOpen] = useState(false);
  const copySubmenuCloseTimeoutRef = useRef<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileModal, setShowMobileModal] = useState(false);
  const isStartAfterDue = task.startDate && task.dueDate && task.startDate >= task.dueDate;
  const canSplit = !isDueBeforeToday(task.dueDate, todayUtc) && !isStartAfterDue;
  const isDone = task.status === 'done';
  const showMenuButton = !isMobile && !editing;
  const isSplitting = planningIds?.has(task.id);
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
  const splitDisabledReason = !canSplit
    ? 'Overdue; adjust due date before splitting.'
    : undefined;
  const dueDateLabel = task.dueDate
    ? task.startDate ? `${task.startDate} to ${task.dueDate}` : task.dueDate
    : '';
  const contextLine = [dueDateLabel, `Root: ${task.rootTitle}`, `Depth: ${task.depth}`]
    .filter(Boolean)
    .join(' - ');

  // Keep local edit buffers in sync when props change and we're not editing
  useEffect(() => {
    if (editing) return;
    setTitle(task.title);
    setDueDate(task.dueDate || '');
    setStartDate(task.startDate || '');
    setDescription(task.description || '');
    setWorkDays(task.workDays || []);
    setAttachments(task.attachments || []);
  }, [editing, task.title, task.dueDate, task.startDate, task.description, task.workDays, task.attachments]);

  useEffect(() => {
    onEditModeChange?.(editing);
  }, [editing, onEditModeChange]);

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

  const handleSave = () => {
    const run = async () => {
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
    run();
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
    setAttachments((prev) => [...prev, ...extracted]);
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

  return (
    <div
      className="task-card"
      onClick={(e) => {
        if (isMobile && !editing) {
          e.stopPropagation();
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
                {task.status === 'done' ? '✅' : task.status === 'in-progress' ? '⏳' : '⭕'}
              </button>
              <div className="form-row">
                <div>
                  <label className="muted">Title</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
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
                      <button
                        type="button"
                        className="subtle"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setDueDate('');
                        }}
                      >
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
                      <button
                        type="button"
                        className="subtle"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setStartDate('');
                        }}
                      >
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
                  {task.status === 'done' ? '✅' : task.status === 'in-progress' ? '⏳' : '⭕'}
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
                  <span className="badge badge-splitting" title="AI is planning the next subtask">
                    <span className="badge-splitting-spinner" aria-hidden="true" />
                    Planning...
                  </span>
                )}
              </div>
              <span className="muted task-due-date">{contextLine}</span>
              {task.workDays?.length ? (
                <span className="muted task-work-days">Work days: {formatWorkDays(task.workDays)}</span>
              ) : null}
            </div>
          )}
        </div>
        {showMenuButton && (
          <div className="task-header-actions">
            <button
              type="button"
              className="secondary collapse-toggle menu-toggle"
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
          </div>
        )}
      </div>
      {task.description && !editing && <p className="muted" style={{ margin: '8px 0 6px' }}>{task.description}</p>}
      {editing ? (
        <div style={{ margin: '8px 0 6px' }}>
          <label className="muted">Description</label>
          <textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      ) : null}
      {editing ? (
        <div style={{ margin: '8px 0 6px' }}>
          <label className="muted">Work days (optional)</label>
          <WorkDaysPicker value={workDays} onChange={(next) => setWorkDays(next ?? [])} />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
            The AI next subtask is always due tomorrow; work days are context for what is realistic today.
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
        {editing && (
          <>
            <button className="primary" onClick={handleSave} disabled={isUploading}>
              {isUploading ? 'Saving...' : 'Save'}
            </button>
            <button className="secondary" onClick={handleCancel} disabled={isUploading}>
              Cancel
            </button>
          </>
        )}
      </div>
      {showMobileModal && isMobile && createPortal(
        <div className="modal-backdrop" onClick={() => setShowMobileModal(false)}>
          <div className="modal mobile-task-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: 12 }}>
              <p className="task-title" style={{ fontSize: 16, marginBottom: 8 }}>{task.title}</p>
              {task.description && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{task.description}</p>}
              <div className="task-meta" style={{ marginBottom: 12 }}>
                {task.dueDate && <span className="badge">Due {task.dueDate}</span>}
                {task.startDate && <span className="badge">Start {task.startDate}</span>}
                {task.workDays?.length ? <span className="badge">Work days {formatWorkDays(task.workDays)}</span> : null}
                <span className="badge">Root {task.rootTitle}</span>
                <span className="badge">Depth {task.depth}</span>
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
              >
                {planningIds?.has(task.id) ? 'Planning...' : 'Next Subtask'}
              </button>
              {isSplitting && onAbortSplit && (
                <button
                  className="secondary"
                  onClick={() => {
                    setShowMobileModal(false);
                    onAbortSplit(task.id);
                  }}
                >
                  Abort planning
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
                  handleCopyBoth();
                }}
                disabled={!hasTitle && !hasDescription}
                title={!hasTitle && !hasDescription ? 'Nothing to copy.' : 'Copy name and description'}
              >
                Copy both
              </button>
              <button
                className="secondary"
                onClick={() => {
                  if (!onShowInTree) return;
                  setShowMobileModal(false);
                  onShowInTree(task.id);
                }}
                disabled={!onShowInTree}
              >
                Show in tree
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setShowMobileModal(false);
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setShowMobileModal(false);
                  onDelete(task.id);
                }}
              >
                Delete
              </button>
              <button className="secondary" onClick={() => setShowMobileModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {contextMenu && !isMobile && createPortal(
        <>
          <div
            className="context-menu-backdrop"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setContextMenu(null);
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
            >
              {planningIds?.has(task.id) ? 'Planning...' : '🤖 Next Subtask'}
            </button>
            {isSplitting && onAbortSplit && (
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  onAbortSplit(task.id);
                }}
              >
                ⛔ Abort planning
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
                onShowInTree?.(task.id);
              }}
              disabled={!onShowInTree}
            >
              🌳 Show in tree
            </button>
            <button
              className="context-menu-item"
              onClick={() => {
                setContextMenu(null);
                setEditing(true);
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
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default SimpleListView;
