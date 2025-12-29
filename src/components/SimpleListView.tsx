import { TaskNode, Attachment } from '../types';
import AttachmentList from './AttachmentList';
import { useEffect, useState, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { extractAttachment } from '../lib/file-extract';

type Props = {
  tasks: TaskNode[];
  onSplit: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
};

type FlatTask = TaskNode & { depth: number; order: number; parentTitle?: string };

const flattenTasks = (tasks: TaskNode[], depth = 0, orderRef = { value: 0 }, parentTitle?: string): FlatTask[] => {
  return tasks.flatMap((t) => {
    const currentOrder = orderRef.value++;
    const self: FlatTask = { ...t, parentId: t.parentId, title: t.title || '(untitled task)', depth, order: currentOrder, parentTitle };
    const children = flattenTasks(t.children || [], depth + 1, orderRef, t.title || '(untitled task)');
    return [self, ...children];
  });
};

const compareTasks = (a: FlatTask, b: FlatTask) => {
  if (!a.dueDate && !b.dueDate) {
    // No due date: preserve tree order
    return a.order - b.order;
  }
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  const dueCmp = a.dueDate.localeCompare(b.dueDate);
  if (dueCmp !== 0) return dueCmp;
  // same due date: deeper depth first
  if (a.depth !== b.depth) return b.depth - a.depth;
  // same depth: preserve tree order
  return a.order - b.order;
};

const isDueTodayOrPast = (dueDate?: string) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? Date.UTC(y, m - 1, d) : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return due <= todayUtc;
};

const SimpleListView = ({ tasks, onSplit, onDelete, onUpdate, planningIds = new Set(), onEditModeChange }: Props) => {
  const flat = flattenTasks(tasks || []);
  const openAndProgress = flat.filter((t) => t.status !== 'done').sort(compareTasks);
  const completed = flat.filter((t) => t.status === 'done').sort((a, b) => -compareTasks(a, b));
  const sorted = [...openAndProgress, ...completed];

  return (
    <div className="task-list">
      {sorted.map((task) => (
        <ListItem key={task.id} task={task} onSplit={onSplit} onDelete={onDelete} onUpdate={onUpdate} onEditModeChange={onEditModeChange} />
      ))}
    </div>
  );
};

const ListItem = ({
  task,
  onSplit,
  onDelete,
  onUpdate,
  planningIds,
  onEditModeChange
}: {
  task: FlatTask;
  onSplit: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [startDate, setStartDate] = useState(task.startDate || '');
  const [description, setDescription] = useState(task.description || '');
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments || []);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const isStartAfterDue = task.startDate && task.dueDate && task.startDate >= task.dueDate;
  const canSplit = !isDueTodayOrPast(task.dueDate) && !isStartAfterDue;
  const isDone = task.status === 'done';
  const showMenuButton = !isMobile && !editing;

  // Keep local edit buffers in sync when props change and we're not editing
  useEffect(() => {
    if (editing) return;
    setTitle(task.title);
    setDueDate(task.dueDate || '');
    setStartDate(task.startDate || '');
    setDescription(task.description || '');
    setAttachments(task.attachments || []);
  }, [editing, task.title, task.dueDate, task.startDate, task.description, task.attachments]);

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
      }
    };
    if (contextMenu) {
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

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
    onUpdate(task.id, {
      title: title.trim() || '(untitled)',
      dueDate: dueDate || undefined,
      startDate: startDate || undefined,
      description: description.trim(),
      attachments
    });
    setEditing(false);
  };

  return (
    <div
      className="task-card"
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
                  {task.status === 'done' ? '✓' : task.status === 'in-progress' ? '◐' : '○'}
                </button>
                <p className={`task-title ${isDone ? 'task-done' : ''}`} style={{ margin: 0 }}>{task.title}</p>
                {task.createdBy === 'ai' && (
                  <span className="badge badge-ai" style={{ fontSize: 10, padding: '2px 6px' }}>
                    AI
                  </span>
                )}
              </div>
              {task.dueDate && (
                <span className="muted task-due-date">
                  {task.startDate ? `${task.startDate} to ${task.dueDate}` : task.dueDate}
                </span>
              )}
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
          <label className="muted">Attachments</label>
          <input
            type="file"
            multiple
            onClick={(e) => e.stopPropagation()}
            onChange={async (e) => {
              e.stopPropagation();
              const files = e.target.files;
              if (!files) return;
              const extracted = await Promise.all(Array.from(files).map((f) => extractAttachment(f)));
              setAttachments((prev) => [...prev, ...extracted]);
              e.target.value = '';
            }}
          />
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
                  {a.name} ✕
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
          <button className="primary" onClick={handleSave}>
            Save
          </button>
        )}
      </div>
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
              title={!canSplit ? 'Due today or overdue; adjust due date before splitting.' : undefined}
            >
              {planningIds?.has(task.id) ? 'Planning…' : '🤖 AI split'}
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
