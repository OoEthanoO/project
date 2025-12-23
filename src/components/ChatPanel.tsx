import { FormEvent, useState } from 'react';
import { ChatMessage } from '../types';

type Props = {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<void> | void;
  busy?: boolean;
  onClear?: () => void;
};

const quickPrompts = [
  'Tighten the due dates for this week',
  'Rewrite subtasks to be more granular',
  'Suggest a weekend catch-up plan',
  'Draft a study loop for the next exam'
];

const ChatPanel = ({ messages, onSend, busy, onClear }: Props) => {
  const [text, setText] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await onSend(text.trim());
    setText('');
  };

  return (
    <div className="panel chat">
      <div className="header">
        <div>
          <p className="title">AI Coach</p>
          <p className="muted">Share notes, tweak plans, or ask for rescheduling.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onClear && (
            <button className="subtle" type="button" onClick={onClear} disabled={busy}>
              Clear chat
            </button>
          )}
          <span className="pill">Context-aware</span>
        </div>
      </div>
      <div className="chat-feed">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role === 'user' ? 'user' : 'ai'}`}>
            {m.content}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <form className="chat-form" onSubmit={submit}>
          <textarea
            placeholder="Ask the planner to adjust scope, prioritize, or rethink a task…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </form>
        <div className="chips">
          {quickPrompts.map((p) => (
            <button
              key={p}
              className="chip"
              type="button"
              onClick={() => {
                setText(p);
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
