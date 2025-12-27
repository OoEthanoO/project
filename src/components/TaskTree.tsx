import { useState, MouseEvent } from 'react';
import { Attachment, TaskNode } from '../types';
import TaskForm from './TaskForm';
import AttachmentList from './AttachmentList';
import { extractAttachment } from '../lib/file-extract';

type Props = {
  tasks: TaskNode[];
  onSplit: (id: string) => void;
  onAddSubtask: (subtask: TaskNode) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  selectedId?: string | null;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  collapsedIds?: Set<string>;
  onToggleCollapsed?: (id: string) => void;
};

const TaskTree = ({
  tasks,
  onSplit,
  onAddSubtask,
  onSelect,
  onDelete,
  onUpdate,
  selectedId,
  planningIds = new Set(),
  onEditModeChange,
  collapsedIds = new Set(),
  onToggleCollapsed
}: Props) => {
  const safeTasks = tasks || [];
  return (
    <div className="task-list">
      {safeTasks.map((task) => (
        <TaskNodeView
          key={task.id || `root-${task.title}`}
          task={task}
          depth={0}
          onSplit={onSplit}
          onAddSubtask={onAddSubtask}
          onSelect={onSelect}
          onDelete={onDelete}
          onUpdate={onUpdate}
          selectedId={selectedId}
          planningIds={planningIds}
          onEditModeChange={onEditModeChange}
          collapsedIds={collapsedIds}
          onToggleCollapsed={onToggleCollapsed}
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
  onSplit,
  onAddSubtask,
  onSelect,
  onDelete,
  onUpdate,
  selectedId,
  planningIds,
  onEditModeChange,
  collapsedIds,
  onToggleCollapsed
}: {
  task: TaskNode;
  depth: number;
  onSplit: (id: string) => void;
  onAddSubtask: (subtask: TaskNode) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  selectedId?: string | null;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
  onEditModeChange?: (isEditing: boolean) => void;
  collapsedIds?: Set<string>;
  onToggleCollapsed?: (id: string) => void;
}) => {
  const [showSubForm, setShowSubForm] = useState(false);
  const selected = selectedId === task.id;
  const canSplit = !isDueTodayOrPast(task.dueDate);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [startDate, setStartDate] = useState(task.startDate || '');
  const [description, setDescription] = useState(task.description || '');
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments || []);
  const isDone = task.status === 'done';
  const isCollapsed = collapsedIds?.has(task.id) ?? false;

  return (
    <div
      className={`task-card ${selected ? 'selected' : ''}`}
      style={{ marginLeft: depth * 12, borderColor: selected ? 'rgba(125,243,225,0.7)' : undefined }}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onSelect(task.id);
      }}
    >
      <div className="task-header">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {task.children?.length ? (
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 8px', minWidth: 0, width: 32 }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapsed?.(task.id);
              }}
            >
              {isCollapsed ? '›' : '∨'}
            </button>
          ) : null}
          {editing ? (
            <>
              Trash
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
            <p className={`task-title ${isDone ? 'task-done' : ''}`}>{task.title}</p>
          )}
          <div className="task-meta">
            {task.dueDate && <span className="badge">Due {task.dueDate}</span>}
            {task.startDate && <span className="badge">Start {task.startDate}</span>}
            <button
              className={`badge badge-status status-${task.status || 'open'}`}
              onClick={(e) => {
                e.stopPropagation();
                const nextStatus = task.status === 'open' ? 'in-progress' : task.status === 'in-progress' ? 'done' : 'open';
                onUpdate(task.id, { status: nextStatus });
              }}
              title="Click to cycle: open → in-progress → done → open"
            >
              {task.status === 'done' ? '✓ ' : task.status === 'in-progress' ? '⟳ ' : '○ '}
              {task.status || 'open'}
            </button>
            <span className={`badge ${task.createdBy === 'ai' ? 'badge-ai' : 'badge-user'}`}>
              {task.createdBy === 'ai' ? 'AI' : 'User'}
            </span>
          </div>
        </div>
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
      <div className="task-actions">
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
          onClick={() => {
            if (editing) {
              onUpdate(task.id, {
                title: title.trim() || '(untitled)',
                dueDate: dueDate || undefined,
                startDate: startDate || undefined,
                description: description.trim(),
                attachments
              });
            }
            setEditing((v) => {
              const newState = !v;
              onEditModeChange?.(newState);
              return newState;
            });
          }}
        >
          {editing ? 'Save' : 'Edit'}
        </button>
        <button className="subtle" onClick={() => onDelete(task.id)}>
          Delete
        </button>
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
              onSplit={onSplit}
              onAddSubtask={onAddSubtask}
              onSelect={onSelect}
              onDelete={onDelete}
              onUpdate={onUpdate}
              selectedId={selectedId}
              planningIds={planningIds}
              onEditModeChange={onEditModeChange}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskTree;
