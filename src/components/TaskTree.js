import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import TaskForm from './TaskForm';
import AttachmentList from './AttachmentList';
import { extractAttachment } from '../lib/file-extract';
const TaskTree = ({ tasks, onSplit, onAddSubtask, onSelect, onDelete, onUpdate, selectedId }) => {
    const safeTasks = tasks || [];
    return (_jsx("div", { className: "task-list", children: safeTasks.map((task) => (_jsx(TaskNodeView, { task: task, depth: 0, onSplit: onSplit, onAddSubtask: onAddSubtask, onSelect: onSelect, onDelete: onDelete, onUpdate: onUpdate, selectedId: selectedId }, task.id || `root-${task.title}`))) }));
};
const isDueTodayOrPast = (dueDate) => {
    if (!dueDate)
        return false;
    const trimmed = dueDate.trim();
    if (!trimmed)
        return false;
    // Normalize to UTC midnight to avoid timezone drift.
    const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
    const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? Date.UTC(y, m - 1, d) : Date.parse(trimmed);
    if (Number.isNaN(due))
        return false;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return due <= todayUtc;
};
const TaskNodeView = ({ task, depth, onSplit, onAddSubtask, onSelect, onDelete, onUpdate, selectedId }) => {
    const [showSubForm, setShowSubForm] = useState(false);
    const selected = selectedId === task.id;
    const canSplit = !isDueTodayOrPast(task.dueDate);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [dueDate, setDueDate] = useState(task.dueDate || '');
    const [description, setDescription] = useState(task.description || '');
    const [attachments, setAttachments] = useState(task.attachments || []);
    const isDone = task.status === 'done';
    return (_jsxs("div", { className: `task-card ${selected ? 'selected' : ''}`, style: { marginLeft: depth * 12, borderColor: selected ? 'rgba(125,243,225,0.7)' : undefined }, onClick: (e) => {
            e.stopPropagation();
            onSelect(task.id);
        }, children: [_jsx("div", { className: "task-header", children: _jsxs("div", { children: [editing ? (_jsxs("div", { className: "form-row", children: [_jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), placeholder: "Title" }), _jsx("input", { type: "date", value: dueDate, onChange: (e) => setDueDate(e.target.value) })] })) : (_jsx("p", { className: "task-title", children: task.title })), _jsxs("div", { className: "task-meta", children: [task.dueDate && _jsxs("span", { className: "badge", children: ["Due ", task.dueDate] }), _jsx("span", { className: "badge", children: task.status ?? 'open' }), _jsx("span", { className: `badge ${task.createdBy === 'ai' ? 'badge-ai' : 'badge-user'}`, children: task.createdBy === 'ai' ? 'AI' : 'User' })] })] }) }), editing ? (_jsx("textarea", { value: description, placeholder: "Description", onChange: (e) => setDescription(e.target.value), style: { margin: '8px 0 6px' } })) : (task.description && _jsx("p", { className: "muted", style: { margin: '8px 0 6px' }, children: task.description })), editing ? (_jsxs("div", { style: { margin: '8px 0 6px' }, children: [_jsx("label", { className: "muted", children: "Attachments" }), _jsx("input", { type: "file", multiple: true, onClick: (e) => e.stopPropagation(), onChange: async (e) => {
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
                            }, children: [a.name, " \u2715"] }, a.id))) }))] })) : (_jsx(AttachmentList, { attachments: task.attachments })), _jsxs("div", { className: "task-actions", children: [_jsx("button", { className: "primary", onClick: () => onSplit(task.id), disabled: !canSplit || isDone, title: !canSplit ? 'Due today or overdue; adjust due date before splitting.' : undefined, children: "AI split" }), _jsx("button", { className: "secondary", onClick: () => setShowSubForm((v) => !v), children: showSubForm ? 'Close form' : 'Add subtask' }), _jsx("button", { className: "secondary", onClick: () => {
                            if (editing) {
                                onUpdate(task.id, {
                                    title: title.trim() || '(untitled)',
                                    dueDate: dueDate || undefined,
                                    description: description.trim(),
                                    attachments
                                });
                            }
                            setEditing((v) => !v);
                        }, children: editing ? 'Save' : 'Edit' }), _jsx("button", { className: "secondary", onClick: () => onUpdate(task.id, {
                            status: task.status === 'done' ? 'open' : 'done'
                        }), children: task.status === 'done' ? 'Reopen' : 'Mark done' }), _jsx("button", { className: "subtle", onClick: () => onDelete(task.id), children: "Delete" })] }), showSubForm && (_jsx("div", { className: "subtasks", style: { marginTop: 12 }, children: _jsx(TaskForm, { onSubmit: (newTask) => onAddSubtask(newTask), parentId: task.id, onCancel: () => setShowSubForm(false) }) })), (task.children ?? []).length > 0 && (_jsx("div", { className: "subtasks", children: (task.children ?? []).map((child, idx) => (_jsx(TaskNodeView, { task: child, depth: depth + 1, onSplit: onSplit, onAddSubtask: onAddSubtask, onSelect: onSelect, onDelete: onDelete, onUpdate: onUpdate, selectedId: selectedId }, child.id || `${task.id}-child-${idx}`))) }))] }));
};
export default TaskTree;
