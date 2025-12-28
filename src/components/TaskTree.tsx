import { useState, MouseEvent, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Attachment, TaskNode } from '../types';
import TaskForm from './TaskForm';
import AttachmentList from './AttachmentList';
import { extractAttachment } from '../lib/file-extract';

type Props = {
  tasks: TaskNode[];
  onSplit: (id: string) => void;
  onAddSubtask: (subtask: TaskNode) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  onReorder: (tasks: TaskNode[]) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  collapsedIds?: Set<string>;
  onToggleCollapsed?: (id: string) => void;
  userId?: string;
  balanceCents?: number;
};

const TaskTree = ({
  tasks,
  onSplit,
  onAddSubtask,
  onDelete,
  onUpdate,
  onReorder,
  planningIds = new Set(),
  onEditModeChange,
  collapsedIds = new Set(),
  onToggleCollapsed,
  userId,
  balanceCents
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
          onAddSubtask={onAddSubtask}
          onDelete={onDelete}
          onUpdate={onUpdate}
          onReorder={onReorder}
          planningIds={planningIds}
          onEditModeChange={onEditModeChange}
          collapsedIds={collapsedIds}
          onToggleCollapsed={onToggleCollapsed}
          userId={userId}
          balanceCents={balanceCents}
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

const isDueTodayOrPast = (dueDate?: string) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  // Normalize to UTC midnight to avoid timezone drift.
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? Date.UTC(y, m - 1, d) : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return due <= todayUtc;
};

const TaskNodeView = ({
  task,
  depth,
  index,
  parentId,
  onSplit,
  onAddSubtask,
  onDelete,
  onUpdate,
  onReorder,
  planningIds,
  onEditModeChange,
  collapsedIds,
  onToggleCollapsed,
  userId,
  balanceCents,
  draggedTaskId,
  setDraggedTaskId,
  dragOverTaskId,
  setDragOverTaskId,
  allTasks
}: {
  task: TaskNode;
  depth: number;
  index: number;
  parentId: string | null;
  onSplit: (id: string) => void;
  onAddSubtask: (subtask: TaskNode) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  onReorder: (tasks: TaskNode[]) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  collapsedIds?: Set<string>;
  onToggleCollapsed?: (id: string) => void;
  userId?: string;
  balanceCents?: number;
  draggedTaskId: string | null;
  setDraggedTaskId: (id: string | null) => void;
  dragOverTaskId: string | null;
  setDragOverTaskId: (id: string | null) => void;
  allTasks: TaskNode[];
}) => {
  const [showSubForm, setShowSubForm] = useState(false);
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const isStartAfterDue = task.startDate && task.dueDate && task.startDate >= task.dueDate;
  const canSplit = !isDueTodayOrPast(task.dueDate) && !isStartAfterDue;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [startDate, setStartDate] = useState(task.startDate || '');
  const [description, setDescription] = useState(task.description || '');
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments || []);
  const isDone = task.status === 'done';
  const isCollapsed = collapsedIds?.has(task.id) ?? false;
  const isDragging = draggedTaskId === task.id;
  const isDragOver = dragOverTaskId === task.id;

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
    setAttachments(task.attachments || []);
  }, [task.title, task.dueDate, task.startDate, task.description, task.attachments]);

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
      // Use setTimeout to avoid closing menu on the same click that opened it
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

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
      className={`task-card ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
      style={{ marginLeft: depth === 0 ? 0 : depth * 12 }}
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: 1 }}>
          <button
            style={{ 
              background: 'none', 
              border: 'none', 
              padding: 0, 
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              marginTop: 2
            }}
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
          </button>          {editing ? (
            <>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <p className={`task-title ${isDone ? 'task-done' : ''}`} style={{ margin: 0 }}>{task.title}</p>
                {task.createdBy === 'ai' && (
                  <span className="badge badge-ai" style={{ fontSize: 10, padding: '2px 6px' }}>
                    AI
                  </span>
                )}
              </div>
              {task.dueDate && (
                <span className="muted" style={{ fontSize: 11 }}>{task.dueDate}</span>
              )}
            </div>
          )}
        </div>
        {task.children?.length ? (
          <button
            type="button"
            className="secondary"
            style={{ 
              padding: '4px 8px', 
              minWidth: 0, 
              width: 32, 
              marginLeft: 8, 
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
        {editing ? (
          <button
            className="primary"
            onClick={() => {
              onUpdate(task.id, {
                title: title.trim() || '(untitled)',
                dueDate: dueDate || undefined,
                startDate: startDate || undefined,
                description: description.trim(),
                attachments
              });
              setEditing(false);
            }}
          >
            Save
          </button>
        ) : (
          <>
            <button
              className="primary"
              onClick={() => onSplit(task.id)}
              disabled={!canSplit || isDone || planningIds?.has(task.id)}
              title={!canSplit ? 'Due today or overdue; adjust due date before splitting.' : undefined}
            >
              {planningIds?.has(task.id) ? 'Planning…' : 'AI split'}
            </button>
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
        {task.children?.some((c) => c.createdBy === 'ai') && (
          <button
            className="secondary"
            onClick={(e) => {
              e.stopPropagation();
              const ok = window.confirm('Clear all AI-generated subtasks under this task?');
              if (!ok) return;
              onUpdate(task.id, { children: (task.children || []).filter((c) => c.createdBy !== 'ai') });
            }}
          >
            Clear AI subtasks
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
            balanceCents={balanceCents}
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
              userId={userId}
              balanceCents={balanceCents}
              draggedTaskId={draggedTaskId}
              setDraggedTaskId={setDraggedTaskId}
              dragOverTaskId={dragOverTaskId}
              setDragOverTaskId={setDragOverTaskId}
              allTasks={allTasks}
            />
          ))}
        </div>
      )}
      
      {/* Mobile task detail modal */}
      {showMobileModal && isMobile && (
        <div className="modal-backdrop" onClick={() => setShowMobileModal(false)}>
          <div className="modal mobile-task-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: 12 }}>
              <p className="task-title" style={{ fontSize: 16, marginBottom: 8 }}>{task.title}</p>
              {task.description && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{task.description}</p>}
              <div className="task-meta" style={{ marginBottom: 12 }}>
                {task.dueDate && <span className="badge">Due {task.dueDate}</span>}
                {task.startDate && <span className="badge">Start {task.startDate}</span>}
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
                title={!canSplit ? 'Due today or overdue; adjust due date before splitting.' : undefined}
              >
                {planningIds?.has(task.id) ? 'Planning…' : 'AI split'}
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
                <button 
                  className="primary" 
                  onClick={() => {
                    onUpdate(task.id, {
                      title: title.trim() || '(untitled)',
                      dueDate: dueDate || undefined,
                      startDate: startDate || undefined,
                      description: description.trim(),
                      attachments
                    });
                    setEditing(false);
                    setShowMobileModal(false);
                  }}
                >
                  Save
                </button>
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
                className="subtle" 
                onClick={() => {
                  setShowMobileModal(false);
                  onDelete(task.id);
                }}
              >
                Delete
              </button>
              {task.children?.some((c) => c.createdBy === 'ai') && (
                <button
                  className="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    const ok = window.confirm('Clear all AI-generated subtasks under this task?');
                    if (!ok) return;
                    setShowMobileModal(false);
                    onUpdate(task.id, { children: (task.children || []).filter((c) => c.createdBy !== 'ai') });
                  }}
                >
                  Clear AI subtasks
                </button>
              )}
              <button className="secondary" onClick={() => setShowMobileModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
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
          {task.children?.some((c) => c.createdBy === 'ai') && (
            <button
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                const ok = window.confirm('Clear all AI-generated subtasks under this task?');
                if (!ok) return;
                setContextMenu(null);
                onUpdate(task.id, { children: (task.children || []).filter((c) => c.createdBy !== 'ai') });
              }}
            >
              🧹 Clear AI subtasks
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
