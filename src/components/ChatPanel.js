import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const quickPrompts = [
    'Tighten the due dates for this week',
    'Rewrite subtasks to be more granular',
    'Suggest a weekend catch-up plan',
    'Draft a study loop for the next exam'
];
const ChatPanel = ({ messages, onSend, busy, onClear }) => {
    const [text, setText] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        if (!text.trim())
            return;
        await onSend(text.trim());
        setText('');
    };
    return (_jsxs("div", { className: "panel chat", children: [_jsxs("div", { className: "header", children: [_jsxs("div", { children: [_jsx("p", { className: "title", children: "AI Coach" }), _jsx("p", { className: "muted", children: "Share notes, tweak plans, or ask for rescheduling." })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [onClear && (_jsx("button", { className: "subtle", type: "button", onClick: onClear, disabled: busy, children: "Clear chat" })), _jsx("span", { className: "pill", children: "Context-aware" })] })] }), _jsx("div", { className: "chat-feed", children: messages.map((m) => (_jsx("div", { className: `chat-bubble ${m.role === 'user' ? 'user' : 'ai'}`, children: m.content }, m.id))) }), _jsxs("div", { className: "chat-input", children: [_jsxs("form", { className: "chat-form", onSubmit: submit, children: [_jsx("textarea", { placeholder: "Ask the planner to adjust scope, prioritize, or rethink a task\u2026", value: text, onChange: (e) => setText(e.target.value) }), _jsx("button", { className: "primary", type: "submit", disabled: busy, children: busy ? 'Thinking…' : 'Send' })] }), _jsx("div", { className: "chips", children: quickPrompts.map((p) => (_jsx("button", { className: "chip", type: "button", onClick: () => {
                                setText(p);
                            }, children: p }, p))) })] })] }));
};
export default ChatPanel;
