import { FormEvent, useState } from 'react';
import { Attachment, TaskNode } from '../types';
import { randomId } from '../lib/task-utils';
import { extractAttachment } from '../lib/file-extract';

type Props = {
  onSubmit: (task: TaskNode) => void;
  parentId?: string | null;
  onCancel?: () => void;
};

const TaskForm = ({ onSubmit, parentId = null, onCancel }: Props) => {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const extracted = await Promise.all(Array.from(files).map((file) => extractAttachment(file)));
    setAttachments((prev) => [...prev, ...extracted]);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      id: randomId(),
      title: title.trim(),
      description: description.trim(),
      dueDate: dueDate || undefined,
      startDate: startDate || undefined,
      attachments,
      children: [],
      parentId,
      status: 'open',
      createdBy: 'user',
      createdAt: new Date().toISOString()
    });
    setTitle('');
    setDescription('');
    setAttachments([]);
    setDueDate('');
    setStartDate('');
    onCancel?.();
  };

  return (
    <form className="task-card" onSubmit={handleSubmit}>
      <div className="form-row">
        <div>
          <label className="muted">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to get done?" />
        </div>
        <div>
          <label className="muted">Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <label className="muted">Start date (optional)</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="muted">Description</label>
        <textarea
          placeholder="Add context, rubric notes, constraints…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="muted">Attachments</label>
        <input type="file" multiple onChange={(e) => handleFiles(e.target.files)} />
        {attachments.length > 0 && (
          <div className="chips">
            {attachments.map((a) => (
              <span key={a.id} className="chip">
                {a.name} {a.extractionStatus && `(${a.extractionStatus})`}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="task-actions" style={{ marginTop: 12 }}>
        <button type="submit" className="primary">
          Add {parentId ? 'subtask' : 'task'}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default TaskForm;
