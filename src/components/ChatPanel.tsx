import { FormEvent, useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

type Props = {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<void> | void;
  busy?: boolean;
  onClear?: () => void;
};

const ChatPanel = ({ messages, onSend, busy, onClear }: Props) => {
  const [text, setText] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const messageText = text.trim();
    setText(''); // Clear immediately
    await onSend(messageText);
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, busy]);

  return (
    <>
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
          <button 
            className="chat-close-button" 
            onClick={() => {
              const event = new CustomEvent('closeChatMobile');
              window.dispatchEvent(event);
            }}
            aria-label="Close chat"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="chat-feed" ref={feedRef}>
        {messages.map((m, idx) => {
          const isPendingUser = busy && m.role === 'user' && idx === messages.length - 1;
          const filesUsed = m.attachmentsUsed ?? [];
          return (
            <div key={m.id} className={`chat-bubble ${m.role === 'user' ? 'user' : 'ai'} ${isPendingUser ? 'pending' : ''}`}>
              <div>{m.content}</div>
            {m.role === 'ai' && filesUsed.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>
                  Files used:
                </p>
                <div className="chips" style={{ gap: 6 }}>
                  {filesUsed.map((name) => (
                    <span key={name} className="chip" style={{ fontSize: 12, padding: '6px 8px' }}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          );
        })}
        {busy && (
          <div className="chat-bubble ai thinking">
            <div className="thinking-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>
      <div className="chat-input">
        <form className="chat-form" onSubmit={submit}>
          <textarea
            placeholder="Ask to adjust, prioritize, or rethink tasks…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
          />
          <button className="primary" type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </form>
      </div>
    </>
  );
};

export default ChatPanel;
