import { Attachment } from '../types';

type Props = {
  attachments?: Attachment[];
};

const AttachmentList = ({ attachments }: Props) => {
  const files = attachments ?? [];
  if (!files.length) return null;
  return (
    <div className="attachment-list">
      {files.map((a, idx) => (
        <span key={a.id || `${a.name}-${idx}`} className="tag">
          {a.name}
        </span>
      ))}
    </div>
  );
};

export default AttachmentList;
