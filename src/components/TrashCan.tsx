import { TaskNode } from '../types';
import AttachmentList from './AttachmentList';

type Props = {
  items: TaskNode[];
  onRestore: (task: TaskNode) => void;
  onDeleteForever: (taskId: string) => void;
  onNavigateToPlan?: () => void;
};

const TrashCan = ({ items, onRestore, onDeleteForever, onNavigateToPlan }: Props) => {
  if (!items || items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon" aria-hidden>🗑️</div>
        <p className="title" style={{ fontSize: 22, margin: '8px 0 6px' }}>Trash is empty</p>
        <p className="muted" style={{ maxWidth: 520, margin: '0 auto 12px' }}>
          When you delete tasks, they’ll show up here. You can restore tasks to their original place or permanently remove them (including attachments).
        </p>
        <div className="empty-actions">
          <button className="primary" onClick={() => onNavigateToPlan?.()}>Back to plan</button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-list">
      {items.map((task) => (
        <div className="task-card" key={task.id}>
          <div className="task-header">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p className="task-title">{task.title}</p>
              <div className="task-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {task.deletedAt && <span className="badge">Deleted {task.deletedAt.slice(0, 10)}</span>}
                {task.dueDate && <span className="badge">Due {task.dueDate}</span>}
                {task.startDate && <span className="badge">Start {task.startDate}</span>}
                <span className="badge">Subtasks {(task.children || []).length}</span>
                {task.attachments?.length ? <span className="badge">{task.attachments.length} file(s)</span> : null}
                <span className={`badge ${task.createdBy === 'ai' ? 'badge-ai' : 'badge-user'}`}>
                  {task.createdBy === 'ai' ? 'AI' : 'User'}
                </span>
              </div>
            </div>
          </div>
          {task.description ? <p className="muted" style={{ margin: '8px 0 6px' }}>{task.description}</p> : null}
          <AttachmentList attachments={task.attachments || []} />
          <div className="task-actions">
            <button className="secondary" onClick={() => onRestore(task)}>Restore</button>
            <button className="subtle" onClick={() => onDeleteForever(task.id)}>Delete permanently</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TrashCan;
