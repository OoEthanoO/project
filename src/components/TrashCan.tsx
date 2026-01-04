import { TaskNode } from '../types';
import AttachmentList from './AttachmentList';
import { formatWorkDays } from '../lib/work-days';

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
        <p className="muted" style={{ maxWidth: 520 }}>
          When you delete tasks, they’ll show up here. You can restore tasks to their original place or permanently remove them (including attachments).
        </p>
        <div className="empty-actions">
          <button className="primary" onClick={() => onNavigateToPlan?.()}>Back to plan</button>
        </div>
      </div>
    );
  }

  const renderSubtasks = (nodes: TaskNode[]) => {
    if (!nodes || nodes.length === 0) return null;
    return (
      <ul className="trash-subtask-list">
        {nodes.map((node) => (
          <li key={node.id} className="trash-subtask-item">
            <div className="trash-subtask-row">
              <span className="trash-subtask-title">{node.title}</span>
              {node.createdBy === 'ai' && <span className="badge badge-ai">AI</span>}
              {node.dueDate && <span className="badge">Due {node.dueDate}</span>}
              {node.workDays?.length ? <span className="badge">Work days {formatWorkDays(node.workDays)}</span> : null}
            </div>
            {node.description ? <p className="muted trash-subtask-description">{node.description}</p> : null}
            {(node.children || []).length > 0 ? renderSubtasks(node.children || []) : null}
          </li>
        ))}
      </ul>
    );
  };

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
                {task.workDays?.length ? <span className="badge">Work days {formatWorkDays(task.workDays)}</span> : null}
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
          {(task.children || []).length > 0 && (
            <div className="trash-subtasks">
              <p className="muted trash-subtasks-title">Subtasks</p>
              {renderSubtasks(task.children || [])}
            </div>
          )}
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
