import { FormEvent, useState } from 'react';
import { Attachment, TaskNode } from '../types';
import { randomId } from '../lib/task-utils';
import { extractAttachment } from '../lib/file-extract';

type Props = {
  onSubmit: (task: TaskNode) => void;
  parentId?: string | null;
  onCancel?: () => void;
  userId?: string; // For R2 file uploads
  balanceCents?: number; // For balance check
};

const TaskForm = ({ onSubmit, parentId = null, onCancel, userId, balanceCents = 0 }: Props) => {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState('');
  
  const hasMinBalance = balanceCents >= 50;

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    if (!userId) {
      setAttachError('You must be logged in to upload files.');
      return;
    }
    if (!hasMinBalance) {
      setAttachError('File uploads require a minimum balance of $0.50. Please top up your account.');
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
    setAttachError('');
    const tooLarge = incoming.filter((f) => f.size > 10 * 1024 * 1024);
    if (tooLarge.length) {
      setAttachError('Files must be 10 MB or smaller. Please compress or split the PDF.');
      return;
    }
    const extracted = await Promise.all(incoming.map((file) => extractAttachment(file, userId)));
    setAttachments((prev) => [...prev, ...extracted as Attachment[]]);
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
          <label className="muted">Start date (optional)</label>
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
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          disabled={!hasMinBalance}
        />
        {!hasMinBalance && (
          <p className="muted" style={{ color: '#f88', fontSize: 12, margin: '4px 0' }}>
            File uploads require a minimum balance of $0.50. Please top up your account.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          Supported: PDF, JPG, JPEG, PNG, WEBP, GIF. Maximum 10 MB per file. Convert other files (e.g., DOCX/PPTX) to PDF before attaching.
        </p>
        {attachError && (
          <p className="muted" style={{ color: '#f88', marginTop: 4 }}>
            {attachError}
          </p>
        )}
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
