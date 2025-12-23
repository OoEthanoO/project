import { useMemo, useState } from 'react';
import TaskForm from './components/TaskForm';
import TaskTree from './components/TaskTree';
import SimpleListView from './components/SimpleListView';
import ChatPanel from './components/ChatPanel';
import { ChatMessage, TaskNode } from './types';
import { addChild, findTask, randomId, removeTask, reorderWithinParent, updateTask } from './lib/task-utils';
import { chatWithPlanner, generateSubtasks } from './lib/ai';
import { useEffect } from 'react';
import AuthForm from './components/AuthForm';
import { currentUser, login, logout, register } from './lib/auth';
import { fetchState, saveState } from './lib/state';
import { fetchBalance, topUp } from './lib/billing';
import { createCheckoutSession } from './lib/payments';

const initialCoachMessage = () => ({
  id: randomId(),
  role: 'ai' as const,
  content:
    'I can turn assignments and tests into daily, actionable steps. Add tasks with due dates, attach materials (PDFs/images), and hit "AI split" to generate subtasks. The chat stays in sync with your plan.',
  createdAt: new Date().toISOString()
});

const isDueTodayOrPast = (dueDate?: string) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? Date.UTC(y, m - 1, d) : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return due <= todayUtc;
};

const App = () => {
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [planningTaskId, setPlanningTaskId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'tree' | 'list'>('tree');
  const [messages, setMessages] = useState<ChatMessage[]>([initialCoachMessage()]);
  const [user, setUser] = useState(() => currentUser());
  const [hydrated, setHydrated] = useState(false);
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('10'); // default $10
  const [toppingUp, setToppingUp] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  const modelTiers = [
    {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      label: 'Tier 0 — Free (text-only)',
      note: 'Free text-only; no attachments. Paste important file content into descriptions.',
      multimodal: false
    },
    {
      id: 'openai/gpt-4o-mini',
      label: 'Tier 1 — Budget multimodal',
      note: 'Budget multimodal; good default for using attachments without heavy spend.',
      multimodal: true
    },
    {
      id: 'openai/gpt-4o',
      label: 'Tier 2 — Strong multimodal',
      note: 'Stronger multimodal; better for complex tasks and mixed attachments.',
      multimodal: true
    },
    {
      id: 'anthropic/claude-3.5-sonnet',
      label: 'Tier 3 — Premium multimodal',
      note: 'Premium multimodal; best for big attachments and deep breakdowns.',
      multimodal: true
    }
  ];
  const [globalInstruction, setGlobalInstruction] = useState('');
  const defaultModel = modelTiers[0]?.id || 'meta-llama/llama-3.3-70b-instruct:free';
  const [modelId, setModelId] = useState(() => import.meta.env.VITE_OPENAI_MODEL || defaultModel);
  const modelDesc =
    modelTiers.find((t) => t.id === modelId)?.note ||
    'Pick a model tier. Paid tiers handle attachments; Tier 0 is text-only.';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) {
        setHydrated(false);
        setTasks([]);
        setMessages([initialCoachMessage()]);
        setGlobalInstruction('');
        setModelId(import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini');
        setSelectedTaskId(null);
        return;
      }
      try {
        const state = await fetchState(user.id);
        if (cancelled) return;
        setTasks(state.tasks || []);
        const chat = state.chat || [];
        setMessages(chat.length ? chat : [initialCoachMessage()]);
        setGlobalInstruction(state.config?.globalInstruction || '');
        setModelId(state.config?.modelId || import.meta.env.VITE_OPENAI_MODEL || defaultModel);
        setSelectedTaskId(state.selectedTaskId || null);
        try {
          const bal = await fetchBalance(user.id);
          if (!cancelled) setBalanceCents(bal);
        } catch (e) {
          console.error('Failed to fetch balance', e);
        }
      } catch (err) {
        console.error('Failed to load state', err);
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !hydrated) return;
    const timer = setTimeout(() => {
      saveState(user.id, {
        tasks,
        chat: messages,
        config: { globalInstruction, modelId },
        selectedTaskId
      }).catch((err) => console.error('Failed to save state', err));
    }, 300);
    return () => clearTimeout(timer);
  }, [user, hydrated, tasks, messages, globalInstruction, modelId, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  // Reload if server version changes (detect new deploy)
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (serverVersion && data.version && data.version !== serverVersion) {
          window.location.reload();
          return;
        }
        setServerVersion(data.version || 'unknown');
      } catch {
        // ignore
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverVersion]);

  // Lightweight polling to stay in sync across devices/browsers
  useEffect(() => {
    if (!user || !hydrated) return;
    const interval = setInterval(async () => {
      try {
        const state = await fetchState(user.id);
        setTasks(state.tasks || []);
        const chat = state.chat || [];
        setMessages(chat.length ? chat : [initialCoachMessage()]);
        setGlobalInstruction(state.config?.globalInstruction || '');
        setModelId(state.config?.modelId || import.meta.env.VITE_OPENAI_MODEL || defaultModel);
        setSelectedTaskId(state.selectedTaskId || null);
        try {
          const bal = await fetchBalance(user.id);
          setBalanceCents(bal);
        } catch (e) {
          console.error('Polling: failed to refresh balance', e);
        }
      } catch (err) {
        console.error('Polling: failed to refresh state', err);
      }
    }, 10000); // 10s poll
    return () => clearInterval(interval);
  }, [user, hydrated]);

  const handleAuthLogin = async (email: string, password: string, remember: boolean) => {
    const u = await login(email, password, remember);
    setUser(u);
    setBalanceCents(u.balanceCents || 0);
  };

  const handleAuthRegister = async (email: string, password: string, name: string, remember: boolean) => {
    const u = await register(email, password, name, remember);
    setUser(u);
    setBalanceCents(u.balanceCents || 0);
  };

  const handleLogout = () => {
    logout();
    setUser(null);
    setBalanceCents(0);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;

      if (e.key === 'Escape' || e.key === 'Esc' || e.key === 'esc') {
        if (showTaskModal || showInstructionModal) {
          e.preventDefault();
          setShowTaskModal(false);
          setShowInstructionModal(false);
        }
        return;
      }

      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          setShowTaskModal(true);
          break;
        case 'g':
          e.preventDefault();
          setShowInstructionModal(true);
          break;
        case 'c':
          e.preventDefault();
          setShowChat((v) => !v);
          break;
        case 'l':
          e.preventDefault();
          setActiveTab((tab) => (tab === 'tree' ? 'list' : 'tree'));
          break;
        case 'arrowup':
          if (activeTab === 'tree' && selectedTaskId) {
            e.preventDefault();
            setTasks((prev) => reorderWithinParent(prev, selectedTaskId, 'up'));
          }
          break;
        case 'arrowdown':
          if (activeTab === 'tree' && selectedTaskId) {
            e.preventDefault();
            setTasks((prev) => reorderWithinParent(prev, selectedTaskId, 'down'));
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showTaskModal, showInstructionModal, activeTab, selectedTaskId]);

  const stats = useMemo(() => {
    const all: TaskNode[] = [];
    const walk = (list: TaskNode[]) => {
      (list || []).forEach((t) => {
        all.push(t);
        walk(t.children || []);
      });
    };
    walk(tasks);
    const nextDue = all
      .filter((t) => t.dueDate)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0]?.dueDate;
    return {
      total: all.length,
      hasContext: all.some((t) => t.attachments.length > 0 || t.description),
      nextDue
    };
  }, [tasks]);

  const handleAddTask = (task: TaskNode) => {
    setTasks((prev) => addChild(prev, task.parentId ?? null, task));
    setSelectedTaskId(task.id);
    setShowTaskModal(false);
  };

  const handleUpdateTask = (id: string, updates: Partial<TaskNode>) => {
    setTasks((prev) =>
      updateTask(prev, id, (t) => ({
        ...t,
        ...updates
      }))
    );
  };

  const handleSplit = async (id: string) => {
    const task = findTask(tasks, id);
    if (!task) return;
    if (!user) return;
    if (isDueTodayOrPast(task.dueDate)) {
      setMessages((prev) => [
        ...prev,
        {
          id: randomId(),
          role: 'ai',
          content: `Skipping split for "${task.title}" because it is due today or overdue. Update the due date to plan forward.`,
          createdAt: new Date().toISOString()
        }
      ]);
      return;
    }
    setPlanning(true);
    setPlanningTaskId(id);
    try {
      const subtasks = await generateSubtasks({ task, conversation: messages, globalInstruction, modelId, userId: user.id });
      setTasks((prev) =>
        updateTask(prev, id, (t) => ({
          ...t,
          children: [...(t.children || []), ...subtasks]
        }))
      );
      if (subtasks[0]) setSelectedTaskId(subtasks[0].id);
    } finally {
      setPlanning(false);
      setPlanningTaskId(null);
    }
  };

  const handleChat = async (text: string) => {
    if (!user) return;
    const userMsg: ChatMessage = { id: randomId(), role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setChatting(true);
    try {
      const aiMessage = await chatWithPlanner(text, tasks, globalInstruction, selectedTaskId, modelId, user.id);
      setMessages((prev) => [...prev, aiMessage]);
    } finally {
      setChatting(false);
    }
  };

  if (!user) {
    return <AuthForm onLogin={handleAuthLogin} onRegister={handleAuthRegister} />;
  }

  return (
    <div className="app-shell">
      <div className="panel">
        <div className="header">
          <div>
            <p className="title">YanPlanner</p>
            <p className="muted">
              Turn assignments and exams into a day-by-day plan. Feed it context and let the AI split the work.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', position: 'relative' }}>
            <div className="pill">
              <span>Tasks</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="pill" title="Account balance (non-refundable)">
              <span>Balance</span>
              <strong>${(balanceCents / 100).toFixed(6)}</strong>
            </div>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              {modelTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.label}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={() => setShowTopUpModal(true)}>
              Add funds
            </button>
            <div className="pill" style={{ cursor: 'pointer' }} onClick={handleLogout} title={user?.email}>
              <span role="img" aria-label="profile">
                👤
              </span>
              <strong>{user?.name || user?.email}</strong>
            </div>
          </div>
        </div>
        <div className="model-info">
          <p className="task-title" style={{ margin: 0, fontSize: 14 }}>
            Model: {modelId}
          </p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{modelDesc}</p>
        </div>
        <div className="floating-buttons">
          <button className="primary" onClick={() => setShowTaskModal(true)}>
            + Add task
          </button>
          <button className="secondary" onClick={() => setShowInstructionModal(true)}>
            Global instructions
          </button>
          <button className="secondary" onClick={() => setShowChat((v) => !v)}>
            {showChat ? 'Hide coach' : 'Show coach'}
          </button>
        </div>
        <div className="tabs">
          <button className={`tab ${activeTab === 'tree' ? 'active' : ''}`} onClick={() => setActiveTab('tree')}>
            Tree view
          </button>
          <button className={`tab ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>
            List by due date
          </button>
        </div>
        <div className="header" style={{ paddingTop: 12 }}>
          <div>
            <p className="title">Plan</p>
            <p className="muted">
              {stats.nextDue ? `Next due: ${stats.nextDue}.` : 'Set due dates to unlock pacing.'}{' '}
              {stats.hasContext ? 'Context attached.' : 'Add descriptions or files for richer splits.'}
            </p>
          </div>
        </div>
        {activeTab === 'tree' ? (
          <TaskTree
            tasks={tasks}
            onSplit={handleSplit}
            onAddSubtask={handleAddTask}
            onSelect={setSelectedTaskId}
            onDelete={(id) => {
              setTasks((prev) => removeTask(prev, id));
              if (selectedTaskId === id) setSelectedTaskId(null);
            }}
            onUpdate={handleUpdateTask}
            selectedId={selectedTaskId}
            planning={planning}
            planningTaskId={planningTaskId}
          />
        ) : (
          <SimpleListView
            tasks={tasks}
            onSplit={handleSplit}
            onSelect={setSelectedTaskId}
            onDelete={(id) => {
              setTasks((prev) => removeTask(prev, id));
              if (selectedTaskId === id) setSelectedTaskId(null);
            }}
            onUpdate={handleUpdateTask}
            planning={planning}
            planningTaskId={planningTaskId}
          />
        )}
      </div>
      <div className={`slideover ${showChat ? 'open' : ''}`}>
        <div className="slideover-panel panel">
          <ChatPanel
            messages={messages}
            onSend={handleChat}
            busy={planning || chatting}
            onClear={() => setMessages([initialCoachMessage()])}
          />
        </div>
      </div>
      {showTaskModal && (
        <div className="modal-backdrop" onClick={() => setShowTaskModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="task-title">Add a new task</p>
            <p className="muted">Include due date and uploads. The AI will use them to split accurately.</p>
            <TaskForm onSubmit={handleAddTask} onCancel={() => setShowTaskModal(false)} />
          </div>
        </div>
      )}
      {showInstructionModal && (
        <div className="modal-backdrop" onClick={() => setShowInstructionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="task-title">Global instructions</p>
            <p className="muted">Guidance the AI should always apply (e.g., "finish a few days early").</p>
            <textarea
              placeholder="Try to plan tasks to finish a few days earlier than the due date…"
              value={globalInstruction}
              onChange={(e) => setGlobalInstruction(e.target.value)}
            />
            <div className="task-actions" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => setShowInstructionModal(false)}>
                Save
              </button>
              <button className="secondary" onClick={() => setGlobalInstruction('')}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
      {showTopUpModal && (
        <div className="modal-backdrop" onClick={() => setShowTopUpModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="task-title">Add funds (non-refundable)</p>
            <p className="muted">You’ll be redirected to Stripe checkout. Top-ups are final.</p>
            <label className="muted">Amount (USD)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
            />
            <div className="task-actions" style={{ marginTop: 12 }}>
              <button
                className="primary"
                disabled={toppingUp}
                onClick={async () => {
                  if (!user) return;
                  const dollars = parseFloat(topUpAmount);
                  if (!Number.isFinite(dollars) || dollars <= 0) return;
                  const cents = Math.round(dollars * 100);
                  setToppingUp(true);
                  try {
                    const session = await createCheckoutSession(user.id, cents);
                    window.location.href = session.url;
                  } catch (err) {
                    console.error(err);
                    alert('Top-up failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
                  } finally {
                    setToppingUp(false);
                  }
                }}
              >
                {toppingUp ? 'Redirecting…' : 'Pay with Stripe'}
              </button>
              <button className="secondary" onClick={() => setShowTopUpModal(false)}>
                Cancel
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              No refunds. For production, connect a PCI-compliant payment provider.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
