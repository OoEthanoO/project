import { FormEvent, useState, useRef, useEffect } from 'react';
import { Attachment, TaskNode, WorkDay } from '../types';
import { randomId } from '../lib/task-utils';
import { extractAttachment } from '../lib/file-extract';
import { apiCall } from '../lib/api-client.js';
import WorkDaysPicker from './WorkDaysPicker';

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
  const [workDays, setWorkDays] = useState<WorkDay[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  const hasMinBalance = balanceCents >= 50;

  useEffect(() => {
    // Auto-focus title input when form mounts
    titleInputRef.current?.focus();
  }, []);

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
    const finalize = async () => {
      // Upload any pending attachments (images/PDFs) before saving
      const uploaded = await Promise.all(
        (attachments || []).map(async (a) => {
          if (a.extractionStatus !== 'pending' || !a.file) return a;
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

      onSubmit({
        id: randomId(),
        title: title.trim(),
        description: description.trim(),
        dueDate: dueDate || undefined,
        startDate: startDate || undefined,
        workDays: workDays.length ? workDays : undefined,
        attachments: uploaded as Attachment[],
        children: [],
        parentId,
        status: 'open',
        createdBy: 'user',
        createdAt: new Date().toISOString()
      });
    };
    finalize();
    setTitle('');
    setDescription('');
    setAttachments([]);
    setDueDate('');
    setStartDate('');
    setWorkDays([]);
    onCancel?.();
  };

  return (
    <form className="task-card task-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <div>
          <label className="muted">Title</label>
          <input ref={titleInputRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to get done?" />
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
        <label className="muted">Work days (optional)</label>
        <WorkDaysPicker value={workDays} onChange={(next) => setWorkDays(next ?? [])} />
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          AI subtasks will be due the day after each work day (ex: Tue work day to Wed due date).
        </p>
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
