import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import AttachmentList from './AttachmentList';
import { useState } from 'react';
import { extractAttachment } from '../lib/file-extract';
const flattenTasks = (tasks, depth = 0, orderRef = { value: 0 }) => {
    return tasks.flatMap((t) => {
        const currentOrder = orderRef.value++;
        const self = { ...t, parentId: t.parentId, title: t.title || '(untitled task)', depth, order: currentOrder };
        const children = flattenTasks(t.children || [], depth + 1, orderRef);
        return [self, ...children];
    });
};
const SimpleListView = ({ tasks, onSplit, onSelect, onDelete, onUpdate }) => {
    const flat = flattenTasks(tasks || []).sort((a, b) => {
        if (!a.dueDate && !b.dueDate) {
            // No due date: preserve tree order
            return a.order - b.order;
        }
        if (!a.dueDate)
            return 1;
        if (!b.dueDate)
            return -1;
        const dueCmp = a.dueDate.localeCompare(b.dueDate);
        if (dueCmp !== 0)
            return dueCmp;
        // same due date: deeper depth first
        if (a.depth !== b.depth)
            return b.depth - a.depth;
        // same depth: preserve tree order
        return a.order - b.order;
    });
    return (_jsx("div", { className: "task-list", children: flat.map((task) => (_jsx(ListItem, { task: task, onSplit: onSplit, onSelect: onSelect, onDelete: onDelete, onUpdate: onUpdate }, task.id))) }));
};
const ListItem = ({ task, onSplit, onSelect, onDelete, onUpdate }) => {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [dueDate, setDueDate] = useState(task.dueDate || '');
    const [attachments, setAttachments] = useState(task.attachments || []);
    const canSplit = task.dueDate ? task.dueDate > new Date().toISOString().slice(0, 10) && task.status !== 'done' : false;
    return (_jsxs("div", { className: "task-card", onClick: () => onSelect(task.id), children: [_jsx("div", { className: "task-header", style: { cursor: 'pointer' }, children: _jsxs("div", { children: [editing ? (_jsxs("div", { className: "form-row", children: [_jsx("input", { value: title, onChange: (e) => setTitle(e.target.value) }), _jsx("input", { type: "date", value: dueDate, onChange: (e) => setDueDate(e.target.value) })] })) : (_jsx("p", { className: "task-title", children: task.title })), _jsxs("div", { className: "task-meta", children: [task.dueDate && _jsxs("span", { className: "badge", children: ["Due ", task.dueDate] }), task.parentId && _jsx("span", { className: "badge", children: "From parent" }), _jsx("span", { className: "badge", children: task.status ?? 'open' }), _jsx("span", { className: `badge ${task.createdBy === 'ai' ? 'badge-ai' : 'badge-user'}`, children: task.createdBy === 'ai' ? 'AI' : 'User' })] })] }) }), task.description && !editing && _jsx("p", { className: "muted", style: { margin: '8px 0 6px' }, children: task.description }), editing ? (_jsxs("div", { style: { margin: '8px 0 6px' }, children: [_jsx("label", { className: "muted", children: "Attachments" }), _jsx("input", { type: "file", multiple: true, onClick: (e) => e.stopPropagation(), onChange: async (e) => {
                            e.stopPropagation();
                            const files = e.target.files;
                            if (!files)
                                return;
                            const extracted = await Promise.all(Array.from(files).map((f) => extractAttachment(f)));
                            setAttachments((prev) => [...prev, ...extracted]);
                            e.target.value = '';
                        } }), attachments.length > 0 && (_jsx("div", { className: "chips", style: { marginTop: 6 }, children: attachments.map((a) => (_jsxs("button", { className: "chip", type: "button", onClick: (ev) => {
                                ev.stopPropagation();
                                setAttachments((prev) => prev.filter((att) => att.id !== a.id));
                            }, children: [a.name, " \u2715"] }, a.id))) }))] })) : (_jsx(AttachmentList, { attachments: task.attachments })), _jsxs("div", { className: "task-actions", children: [_jsx("button", { className: "primary", onClick: () => onSplit(task.id), disabled: !canSplit, title: !task.dueDate ? 'Add a due date to split.' : undefined, children: "AI split" }), _jsx("button", { className: "secondary", onClick: (e) => {
                            e.stopPropagation();
                            if (editing) {
                                onUpdate(task.id, { title: title.trim() || '(untitled)', dueDate: dueDate || undefined, attachments });
                            }
                            setEditing((v) => !v);
                        }, children: editing ? 'Save' : 'Edit' }), _jsx("button", { className: "secondary", onClick: (e) => {
                            e.stopPropagation();
                            onUpdate(task.id, { status: task.status === 'done' ? 'open' : 'done' });
                        }, children: task.status === 'done' ? 'Reopen' : 'Mark done' }), _jsx("button", { className: "secondary", onClick: (e) => {
                            e.stopPropagation();
                            onDelete(task.id);
                        }, children: "Delete" })] })] }));
};
export default SimpleListView;
