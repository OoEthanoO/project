import { jsx as _jsx } from "react/jsx-runtime";
const AttachmentList = ({ attachments }) => {
    const files = attachments ?? [];
    if (!files.length)
        return null;
    return (_jsx("div", { className: "task-meta", style: { flexWrap: 'wrap' }, children: files.map((a, idx) => (_jsx("span", { className: "tag", children: a.name }, a.id || `${a.name}-${idx}`))) }));
};
export default AttachmentList;
