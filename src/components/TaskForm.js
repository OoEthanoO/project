import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { randomId } from '../lib/task-utils';
import { extractAttachment } from '../lib/file-extract';
const TaskForm = ({ onSubmit, parentId = null, onCancel }) => {
    const [title, setTitle] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [description, setDescription] = useState('');
    const [attachments, setAttachments] = useState([]);
    const handleFiles = async (files) => {
        if (!files)
            return;
        const extracted = await Promise.all(Array.from(files).map((file) => extractAttachment(file)));
        setAttachments((prev) => [...prev, ...extracted]);
    };
    const handleSubmit = (e) => {
        e.preventDefault();
        if (!title.trim())
            return;
        onSubmit({
            id: randomId(),
            title: title.trim(),
            description: description.trim(),
            dueDate: dueDate || undefined,
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
        onCancel?.();
    };
    return (_jsxs("form", { className: "task-card", onSubmit: handleSubmit, children: [_jsxs("div", { className: "form-row", children: [_jsxs("div", { children: [_jsx("label", { className: "muted", children: "Title" }), _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), placeholder: "What needs to get done?" })] }), _jsxs("div", { children: [_jsx("label", { className: "muted", children: "Due date" }), _jsx("input", { type: "date", value: dueDate, onChange: (e) => setDueDate(e.target.value) })] })] }), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("label", { className: "muted", children: "Description" }), _jsx("textarea", { placeholder: "Add context, rubric notes, constraints\u2026", value: description, onChange: (e) => setDescription(e.target.value) })] }), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("label", { className: "muted", children: "Attachments" }), _jsx("input", { type: "file", multiple: true, onChange: (e) => handleFiles(e.target.files) }), attachments.length > 0 && (_jsx("div", { className: "chips", children: attachments.map((a) => (_jsxs("span", { className: "chip", children: [a.name, " ", a.extractionStatus && `(${a.extractionStatus})`] }, a.id))) }))] }), _jsxs("div", { className: "task-actions", style: { marginTop: 12 }, children: [_jsxs("button", { type: "submit", className: "primary", children: ["Add ", parentId ? 'subtask' : 'task'] }), onCancel && (_jsx("button", { type: "button", className: "secondary", onClick: onCancel, children: "Cancel" }))] })] }));
};
export default TaskForm;
