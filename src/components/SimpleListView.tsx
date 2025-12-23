import { TaskNode, Attachment } from '../types';
import AttachmentList from './AttachmentList';
import { useState } from 'react';
import { extractAttachment } from '../lib/file-extract';

type Props = {
  tasks: TaskNode[];
  onSplit: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
};

type FlatTask = TaskNode & { depth: number; order: number };

const flattenTasks = (tasks: TaskNode[], depth = 0, orderRef = { value: 0 }): FlatTask[] => {
  return tasks.flatMap((t) => {
    const currentOrder = orderRef.value++;
    const self: FlatTask = { ...t, parentId: t.parentId, title: t.title || '(untitled task)', depth, order: currentOrder };
    const children = flattenTasks(t.children || [], depth + 1, orderRef);
    return [self, ...children];
  });
};

const SimpleListView = ({ tasks, onSplit, onSelect, onDelete, onUpdate, planningIds = new Set() }: Props) => {
  const flat = flattenTasks(tasks || []).sort((a, b) => {
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
  });

  return (
    <div className="task-list">
      {flat.map((task) => (
        <ListItem key={task.id} task={task} onSplit={onSplit} onSelect={onSelect} onDelete={onDelete} onUpdate={onUpdate} />
      ))}
    </div>
  );
};

const ListItem = ({
  task,
  onSplit,
  onSelect,
  onDelete,
  onUpdate,
  planningIds
}: {
  task: FlatTask;
  onSplit: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TaskNode>) => void;
  planningIds?: Set<string>;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [startDate, setStartDate] = useState(task.startDate || '');
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments || []);
  const canSplit = task.dueDate ? task.dueDate > new Date().toISOString().slice(0, 10) && task.status !== 'done' : false;
  const isDone = task.status === 'done';

  return (
    <div className="task-card" onClick={() => onSelect(task.id)}>
      <div className="task-header" style={{ cursor: 'pointer' }}>
        <div>
          {editing ? (
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
          ) : (
            <p className="task-title">{task.title}</p>
          )}
          <div className="task-meta">
            {task.dueDate && <span className="badge">Due {task.dueDate}</span>}
            {task.startDate && <span className="badge">Start {task.startDate}</span>}
            {task.parentId && <span className="badge">From parent</span>}
            <span className="badge">{task.status ?? 'open'}</span>
            <span className={`badge ${task.createdBy === 'ai' ? 'badge-ai' : 'badge-user'}`}>
              {task.createdBy === 'ai' ? 'AI' : 'User'}
            </span>
          </div>
        </div>
      </div>
      {task.description && !editing && <p className="muted" style={{ margin: '8px 0 6px' }}>{task.description}</p>}
      {editing ? (
        <div style={{ margin: '8px 0 6px' }}>
          <label className="muted">Description</label>
          <textarea
            placeholder="Description"
            value={task.description || ''}
            onChange={(e) => onUpdate(task.id, { description: e.target.value })}
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
      <div className="task-actions">
        <button
          className="primary"
          onClick={() => onSplit(task.id)}
          disabled={!canSplit || planningIds?.has(task.id)}
          title={!task.dueDate ? 'Add a due date to split.' : undefined}
        >
          {planningIds?.has(task.id) ? 'Planning…' : 'AI split'}
        </button>
        <button
          className="secondary"
          onClick={(e) => {
            e.stopPropagation();
            if (editing) {
              onUpdate(task.id, {
                title: title.trim() || '(untitled)',
                dueDate: dueDate || undefined,
                startDate: startDate || undefined,
                attachments
              });
            }
            setEditing((v) => !v);
          }}
        >
          {editing ? 'Save' : 'Edit'}
        </button>
        <button
          className="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export default SimpleListView;
