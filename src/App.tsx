import { useMemo, useRef, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import TaskForm from './components/TaskForm';
import TaskTree from './components/TaskTree';
import TrashCan from './components/TrashCan';
import SimpleListView from './components/SimpleListView';
import ChatPanel from './components/ChatPanel';
import AdminPanel from './components/AdminPanel';
import { ChatMessage, TaskNode } from './types';
import { addChild, findTask, randomId, removeTask, reorderWithinParent, updateTask, getR2KeysForTask, getAncestors, moveTaskToTop, moveTaskToBottom } from './lib/task-utils';
import { chatWithPlanner, generateSubtasks } from './lib/ai';
import { useEffect } from 'react';
import AuthForm from './components/AuthForm';
import { currentUser, login, logout, register } from './lib/auth';
import { fetchState, saveState } from './lib/state';
import { fetchBalance, topUp } from './lib/billing';
import { createCheckoutSession } from './lib/payments';
import { MODEL_TIERS, getDefaultModel, getValidModelOrDefault } from '../shared/model-config.js';
import { getAvailableBackups, restoreFromBackup, clearBackup } from './lib/backup-recovery.js';

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
  const [trash, setTrash] = useState<TaskNode[]>([]);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const [planningIds, setPlanningIds] = useState<Set<string>>(new Set());
  const [chatting, setChatting] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'tree' | 'list' | 'trash' | 'settings'>('tree');
  const [messages, setMessages] = useState<ChatMessage[]>([initialCoachMessage()]);
  const [user, setUser] = useState(() => currentUser());
  const [hydrated, setHydrated] = useState(false);
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('10'); // default $10
  const [toppingUp, setToppingUp] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [isEditingTask, setIsEditingTask] = useState(false); // Track if any task is in edit mode
  const [backupAvailable, setBackupAvailable] = useState<any>(null); // Track if backup exists
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [settingsView, setSettingsView] = useState<'main' | 'backup'>('main');
  // Track recent user-initiated mutations (e.g., rapid keyboard reorders) to avoid poll overwrites
  const lastUserActionRef = useRef(0);
  const lastContentTabRef = useRef<'tree' | 'list' | 'trash'>('tree');
  // Prevent spamming version-update logs and duplicate reload timers
  const pendingReloadRef = useRef(false);
  const navigate = useNavigate();

  const modelTiers = MODEL_TIERS;
  const [globalInstruction, setGlobalInstruction] = useState('');
  const defaultModel = getDefaultModel().id;
  const [modelId, setModelId] = useState(defaultModel);
  const currentTier = modelTiers.find((t) => t.id === modelId);
  const isPaidModel = currentTier?.multimodal ?? false;
  const hasMinBalance = balanceCents >= 50;
  const canUsePaidModel = !isPaidModel || hasMinBalance;
  
  const modelDesc =
    modelTiers.find((t) => t.id === modelId)?.note ||
    'Pick a model tier. Paid tiers handle attachments; Tier 0 is text-only.';

  useEffect(() => {
    if (activeTab !== 'settings') {
      lastContentTabRef.current = activeTab;
    }
  }, [activeTab]);

  // Check for available backup when user logs in or tasks change
  useEffect(() => {
    if (user) {
      const backup = getAvailableBackups(user.id);
      if (backup && backup.taskCount > 0) {
        setBackupAvailable(backup);
      } else {
        setBackupAvailable(null);
      }
    }
  }, [user, tasks]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) {
        setHydrated(false);
        setTasks([]);
        setTrash([]);
        setMessages([initialCoachMessage()]);
        setGlobalInstruction('');
        setModelId(defaultModel);
        return;
      }
      try {
        // CRITICAL: Check localStorage backup FIRST before fetching from server
        let localBackup = null;
        try {
          const backupStr = localStorage.getItem('yanplanner_backup_' + user.id);
          if (backupStr) {
            localBackup = JSON.parse(backupStr);
          }
        } catch (e) {
          console.error('Failed to read local backup', e);
        }
        
        const state = await fetchState(user.id);
        if (cancelled) return;
        
        // CRITICAL: Never replace existing data with empty data from server
        // This prevents data loss from race conditions or server errors
        const newTasks = state.tasks || [];
        const newTrash = state.trash || [];
        
        // If server returns empty but we have a local backup, prefer the backup
        if (newTasks.length === 0 && localBackup && localBackup.tasks?.length > 0) {
          console.warn('[RECOVERY] Server returned empty data but local backup exists. Using backup.');
          console.warn(`[RECOVERY] Backup from ${localBackup.timestamp} with ${localBackup.tasks.length} tasks`);
          setTasks(localBackup.tasks);
          setTrash(localBackup.trash || []);
          // Save backup to server immediately
          setTimeout(() => {
            saveState(user.id, {
              tasks: localBackup.tasks,
              trash: localBackup.trash || [],
              chat: messages,
              config: { globalInstruction, modelId }
            }).catch((err) => console.error('Failed to restore backup to server', err));
          }, 1000);
        } else {
          // Normal case: use server data
          setTasks(newTasks);
          setTrash(newTrash);
          
          // Create/update backup in localStorage (but only if we have data)
          if (newTasks.length > 0 || newTrash.length > 0) {
            try {
              localStorage.setItem('yanplanner_backup_' + user.id, JSON.stringify({
                tasks: newTasks,
                trash: newTrash,
                timestamp: new Date().toISOString()
              }));
            } catch (e) {
              console.error('Failed to create backup', e);
            }
          }
        }
        const chat = state.chat || [];
        setMessages((prev) => {
          if (chat.length >= prev.length) return chat.length ? chat : [initialCoachMessage()];
          return prev.length ? prev : chat.length ? chat : [initialCoachMessage()];
        });
        setGlobalInstruction(state.config?.globalInstruction || '');
        const loadedModelId = state.config?.modelId || import.meta.env.VITE_OPENAI_MODEL || defaultModel;
        setModelId(getValidModelOrDefault(loadedModelId));
        // Ensure collapsed IDs are typed as Set<string>, but don't override recent user toggles
        const incomingCollapsed = new Set<string>((state.config?.collapsedTaskIds || []) as string[]);
        if (Date.now() - lastUserActionRef.current > 800) {
          setCollapsedTaskIds(incomingCollapsed);
        }
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
        trash,
        chat: messages,
        config: { globalInstruction, modelId, collapsedTaskIds: Array.from(collapsedTaskIds) },
      }).catch((err) => console.error('Failed to save state', err));
    }, 300);
    return () => clearTimeout(timer);
  }, [user, hydrated, tasks, trash, messages, globalInstruction, modelId, collapsedTaskIds]);

  // Remove auto-select effect

  // Reload if server version changes (detect new deploy)
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        // Dynamically import to avoid circular deps
        const { apiCall } = await import('./lib/api-client.js');
        const res = await apiCall('/api/state?version');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const newVersion = data.version || 'unknown';
        
        // First time: just store the version
        if (!serverVersion) {
          console.log('[version] Initial version:', newVersion);
          setServerVersion(newVersion);
          return;
        }
        
        console.log('[version] Current:', serverVersion, 'Server:', newVersion);
        
        // Subsequent checks: compare and reload if changed (reload immediately)
        if (newVersion !== serverVersion) {
          if (pendingReloadRef.current) return; // already reloading
          pendingReloadRef.current = true;
          console.log(`[version] Server updated from ${serverVersion} to ${newVersion}, reloading...`);
          window.location.reload();
          return;
        }
      } catch (err) {
        console.error('[version] Check failed:', err);
      }
    };
    check();
    const id = setInterval(check, 10000); // Check every 10s
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverVersion, showTaskModal, showInstructionModal, showSettingsModal, showTopUpModal, chatting, isEditingTask]);

  // Lightweight polling to stay in sync across devices/browsers
  useEffect(() => {
    if (!user || !hydrated) return;
    let consecutiveFailures = 0;
    const interval = setInterval(async () => {
      const startedAt = Date.now();
      // Don't poll if user is actively working (prevents interrupting task editing, chat, or other modals)
      if (showTaskModal || showInstructionModal || showSettingsModal || showTopUpModal || chatting || isEditingTask) {
        return;
      }
      // If the user just modified tasks (e.g., rapid keyboard reorders), pause polling to avoid overwriting
      if (Date.now() - lastUserActionRef.current < 2000) {
        return;
      }
      // Skip polling when offline or during network transitions
      if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
        return;
      }
      try {
        const state = await fetchState(user.id);
        if (startedAt < lastUserActionRef.current) {
          return;
        }
        // Only update tasks if they actually changed
        setTasks((prev) => {
          const newTasks = state.tasks || [];
          if (JSON.stringify(prev) === JSON.stringify(newTasks)) return prev;
          // CRITICAL SAFEGUARD: Never replace existing data with empty data
          if (prev.length > 0 && newTasks.length === 0 && !state._explicitlyEmpty) {
            console.warn('[POLLING SAFEGUARD] Refusing to replace', prev.length, 'tasks with empty array');
            return prev;
          }
          console.log('[POLLING] Updating tasks array, isEditingTask:', isEditingTask);
          return newTasks;
        });
        setTrash((prev) => {
          const newTrash = state.trash || [];
          if (JSON.stringify(prev) === JSON.stringify(newTrash)) return prev;
          // CRITICAL SAFEGUARD: Never replace trash with empty data unless intentional
          if (prev.length > 0 && newTrash.length === 0 && !state._explicitlyEmpty) {
            console.warn('[POLLING SAFEGUARD] Refusing to replace', prev.length, 'trash items with empty array');
            return prev;
          }
          return newTrash;
        });
        const chat = state.chat || [];
        // Avoid overwriting with shorter/empty chat if the server didn't persist yet
        setMessages((prev) => {
          if (chat.length >= prev.length) {
            const newChat = chat.length ? chat : [initialCoachMessage()];
            if (JSON.stringify(prev) === JSON.stringify(newChat)) return prev;
            return newChat;
          }
          const fallback = prev.length ? prev : chat.length ? chat : [initialCoachMessage()];
          return fallback;
        });
        // Only update config if changed
        const newInstruction = state.config?.globalInstruction || '';
        const newModelId = state.config?.modelId || import.meta.env.VITE_OPENAI_MODEL || defaultModel;
        const validatedModelId = getValidModelOrDefault(newModelId);
        // Type collapsed IDs explicitly to avoid Set<unknown>
        const newCollapsedIds: Set<string> = new Set<string>((state.config?.collapsedTaskIds || []) as string[]);
        setGlobalInstruction((prev) => prev === newInstruction ? prev : newInstruction);
        setModelId((prev) => prev === validatedModelId ? prev : validatedModelId);
        if (startedAt < lastUserActionRef.current) {
          // Skip collapsed-id update if user interacted after this poll started
        } else {
          setCollapsedTaskIds((prev) => {
            const prevArray = Array.from(prev).sort().join(',');
            const newArray = Array.from(newCollapsedIds).sort().join(',');
            return prevArray === newArray ? prev : newCollapsedIds;
          });
        }
        try {
          const bal = await fetchBalance(user.id);
          setBalanceCents((prev) => prev === bal ? prev : bal);
        } catch (e) {
          console.error('Polling: failed to refresh balance', e);
        }
      } catch (err) {
        consecutiveFailures += 1;
        // Log only the first failure to reduce console noise during auto-reloads or brief outages
        if (consecutiveFailures === 1) {
          console.error('Polling: failed to refresh state', err);
        }
      }
    }, 10000); // 10s poll
    return () => clearInterval(interval);
  }, [user, hydrated, showTaskModal, showInstructionModal, showSettingsModal, showTopUpModal, chatting, isEditingTask, defaultModel]);

  const handleAuthLogin = async (email: string, password: string, remember: boolean) => {
    const u = await login(email, password, remember);
    setUser(u);
    setBalanceCents(u.balanceCents || 0);
    setAuthNotice('');
  };

  const handleAuthRegister = async (email: string, password: string, name: string, remember: boolean) => {
    const u = await register(email, password, name, remember);
    setUser(u);
    setBalanceCents(u.balanceCents || 0);
    setAuthNotice('');
  };

  const handleLogout = () => {
    logout();
    setUser(null);
    setTasks([]);
    setTrash([]);
    setBalanceCents(0);
    setAuthNotice('');
  };

  // Auto-log-out any unverified session restored from storage
  useEffect(() => {
    if (user && user.emailVerified === false) {
      console.warn('[auth] user is not verified; logging out');
      handleLogout();
      setAuthNotice('Please verify your email from your inbox, then sign in.');
    }
  }, [user]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;

      if (e.key === 'Escape' || e.key === 'Esc' || e.key === 'esc') {
        if (showTaskModal || showInstructionModal || showSettingsModal) {
          e.preventDefault();
          setShowTaskModal(false);
          setShowInstructionModal(false);
          setShowSettingsModal(false);
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
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    
    // Mobile chat close handler
    const handleCloseChatMobile = () => setShowChat(false);
    window.addEventListener('closeChatMobile', handleCloseChatMobile);
    
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('closeChatMobile', handleCloseChatMobile);
    };
  }, [showTaskModal, showInstructionModal, showSettingsModal, activeTab]);

  const stats = useMemo(() => {
    const all: TaskNode[] = [];
    const walk = (list: TaskNode[]) => {
      (list || []).forEach((t) => {
        all.push(t);
        walk(t.children || []);
      });
    };
    walk(tasks);
    return {
      total: all.length,
      hasContext: all.some((t) => t.attachments.length > 0 || t.description)
    };
  }, [tasks]);

  const handleAddTask = (task: TaskNode) => {
    lastUserActionRef.current = Date.now();
    setTasks((prev) => addChild(prev, task.parentId ?? null, task));
    setShowTaskModal(false);
  };

  const deleteR2Files = async (keys: string[]) => {
    if (!keys || keys.length === 0) return;
    try {
      const { apiCall } = await import('./lib/api-client.js');
      await apiCall('/api/state', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys })
      });
      console.log('Deleted', keys.length, 'files from R2');
    } catch (err) {
      console.error('Failed to delete R2 files:', err);
    }
  };

  const softDeleteTask = (id: string) => {
    lastUserActionRef.current = Date.now();
    const taskToTrash = findTask(tasks, id);
    if (!taskToTrash) return;
    const copy = typeof structuredClone === 'function' ? structuredClone(taskToTrash) : (JSON.parse(JSON.stringify(taskToTrash)) as TaskNode);
    const trashedCopy: TaskNode = {
      ...copy,
      deletedAt: new Date().toISOString(),
      trashedFromParentId: taskToTrash.parentId ?? null
    };
    setTasks((prev) => removeTask(prev, id));
    setTrash((prev) => [trashedCopy, ...prev]);
  };

  const restoreTask = (task: TaskNode) => {
    lastUserActionRef.current = Date.now();
    const parentCandidate = task.trashedFromParentId ?? task.parentId ?? null;
    const parentExists = parentCandidate ? findTask(tasks, parentCandidate) : undefined;
    const restoredParentId = parentExists ? parentCandidate : null;
    const restoredTask: TaskNode = {
      ...task,
      deletedAt: undefined,
      trashedFromParentId: undefined,
      parentId: restoredParentId
    };
    setTrash((prev) => removeTask(prev, task.id));
    setTasks((prev) => addChild(prev, restoredParentId, restoredTask));
  };

  const permanentlyDeleteFromTrash = (id: string) => {
    lastUserActionRef.current = Date.now();
    const target = findTask(trash, id);
    if (!target) return;
    const r2Keys = getR2KeysForTask(trash, id);
    setTrash((prev) => removeTask(prev, id));
    if (r2Keys.length > 0) deleteR2Files(r2Keys);
  };

  const handleUpdateTask = (id: string, updates: Partial<TaskNode>) => {
    lastUserActionRef.current = Date.now();
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
    if (isPaidModel && !hasMinBalance) {
      alert('Minimum balance of $0.50 required to use paid models. Please add funds or switch to the free tier.');
      return;
    }
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
    setPlanningIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      const ancestors = getAncestors(tasks, id);
      const subtasks = await generateSubtasks({ task, ancestors, conversation: messages, globalInstruction, modelId, userId: user.id });
      setTasks((prev) =>
        updateTask(prev, id, (t) => ({
          ...t,
          children: [...(t.children || []), ...subtasks]
        }))
      );
    } finally {
      setPlanningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleChat = async (text: string) => {
    if (!user) return;
    if (isPaidModel && !hasMinBalance) {
      const errorMsg: ChatMessage = {
        id: randomId(),
        role: 'ai',
        content: 'Minimum balance of $0.50 required to use paid models. Please add funds or switch to the free tier (Tier 0).',
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, errorMsg]);
      return;
    }
    const userMsg: ChatMessage = { id: randomId(), role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setChatting(true);
    try {
      const aiMessage = await chatWithPlanner(text, tasks, globalInstruction, null, modelId, user.id);
      setMessages((prev) => [...prev, aiMessage]);
      // Persist chat immediately to reduce chance of losing the last response
      saveState(user.id, {
        tasks,
        trash,
        chat: [...messages, userMsg, aiMessage],
        config: { globalInstruction, modelId }
      }).catch((err) => console.error('Failed to persist chat', err));
    } catch (err) {
      console.error('Chat failed', err);
      const errorMsg: ChatMessage = {
        id: randomId(),
        role: 'ai',
        content: `Sorry, I couldn't respond. ${err instanceof Error ? err.message : 'Please try again.'}`,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatting(false);
    }
  };

  const handleClearChat = async () => {
    if (!user) return;
    const clearedMessages = [initialCoachMessage()];
    setMessages(clearedMessages);
    // Immediately save to server to prevent polling from restoring old messages
    try {
      await saveState(user.id, {
        tasks,
        trash,
        chat: clearedMessages,
        config: { globalInstruction, modelId }
      });
    } catch (err) {
      console.error('Failed to save cleared chat', err);
    }
  };

  const renderSettingsContent = (onDone: () => void) => {
    const closeSettings = () => {
      setSettingsView('main');
      onDone();
    };

    if (settingsView === 'backup' && backupAvailable) {
      return (
        <>
          <p className="task-title">Backup details</p>
          <p className="muted">Review the backup contents and compare with your current plan.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <p className="task-title" style={{ fontSize: 14, marginBottom: 6 }}>Current plan</p>
              <p className="muted" style={{ marginTop: 0 }}>Tasks: {tasks.length}</p>
              <ul style={{ maxHeight: 160, overflow: 'auto', paddingLeft: 18 }}>
                {(tasks || []).slice(0, 50).map((t) => (
                  <li key={t.id}>{t.title}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="task-title" style={{ fontSize: 14, marginBottom: 6 }}>Backup from {new Date(backupAvailable.timestamp).toLocaleString()}</p>
              <p className="muted" style={{ marginTop: 0 }}>Tasks: {backupAvailable.taskCount}</p>
              <ul style={{ maxHeight: 160, overflow: 'auto', paddingLeft: 18 }}>
                {(backupAvailable.tasks || []).slice(0, 50).map((t: any, idx: number) => (
                  <li key={t.id || idx}>{t.title}</li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ fontSize: 12 }}>
              Differences: {Math.abs((backupAvailable.taskCount || 0) - (tasks.length || 0))} task(s) difference.
            </p>
          </div>
          <div className="task-actions" style={{ marginTop: 12 }}>
            <button className="secondary" onClick={() => setSettingsView('main')}>← Back</button>
            <button
              className="primary"
              onClick={async () => {
                if (!user) return;
                const confirmed = window.confirm('Restore this backup and replace your current tasks?');
                if (!confirmed) return;
                try {
                  const restored = restoreFromBackup(user.id);
                  lastUserActionRef.current = Date.now();
                  setTasks(restored.tasks);
                  setTrash(restored.trash);
                  await saveState(user.id, {
                    tasks: restored.tasks,
                    trash: restored.trash,
                    chat: messages,
                    config: { globalInstruction, modelId }
                  });
                  clearBackup(user.id);
                  setBackupAvailable(null);
                  closeSettings();
                  alert('Backup restored successfully!');
                } catch (e) {
                  alert('Failed to restore backup: ' + (e instanceof Error ? e.message : 'Unknown error'));
                }
              }}
            >
              Restore backup
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        <p className="task-title">Settings</p>
        
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Global instructions</p>
          <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>Guidance the AI should always apply (e.g., "finish a few days early").</p>
          <textarea
            placeholder="Try to plan tasks to finish a few days earlier than the due date…"
            value={globalInstruction}
            onChange={(e) => setGlobalInstruction(e.target.value)}
            style={{ minHeight: 80 }}
          />
          <button className="secondary" onClick={() => setGlobalInstruction('')} style={{ marginTop: 'var(--space-sm)' }}>
            Clear instructions
          </button>
        </div>
        
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>AI Model</p>
          {isPaidModel && !hasMinBalance && (
            <p style={{ margin: '0 0 var(--space-sm) 0', fontSize: 13, color: '#d32f2f', fontWeight: 500 }}>
              ⚠️ Minimum $0.50 balance required. Add funds or switch to Tier 0 (free).
            </p>
          )}
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
          >
            {modelTiers.map((tier) => {
              const modelName = tier.id.split('/').pop();
              return (
                <option key={tier.id} value={tier.id}>
                  {tier.label} — {modelName}
                </option>
              );
            })}
          </select>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {modelTiers.find((t) => t.id === modelId)?.note}
          </p>
        </div>
        
        {backupAvailable && backupAvailable.taskCount > 0 && (
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Backup available</p>
            <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
              A backup from {new Date(backupAvailable.timestamp).toLocaleString()} was found with {backupAvailable.taskCount} tasks.
            </p>
            {tasks.length === 0 ? (
              <button
                className="primary"
                onClick={async () => {
                  if (!user) return;
                  try {
                    const restored = restoreFromBackup(user.id);
                    lastUserActionRef.current = Date.now();
                    setTasks(restored.tasks);
                    setTrash(restored.trash);
                    await saveState(user.id, {
                      tasks: restored.tasks,
                      trash: restored.trash,
                      chat: messages,
                      config: { globalInstruction, modelId }
                    });
                    clearBackup(user.id);
                    setBackupAvailable(null);
                    closeSettings();
                    alert('Backup restored successfully!');
                  } catch (e) {
                    alert('Failed to restore backup: ' + (e instanceof Error ? e.message : 'Unknown error'));
                  }
                }}
              >
                🔄 Restore backup
              </button>
            ) : (
              <button className="secondary" onClick={() => setSettingsView('backup')}>
                📦 View backup details
              </button>
            )}
          </div>
        )}
        
        <div className="task-actions">
          <button className="primary" onClick={closeSettings}>
            Done
          </button>
        </div>
      </>
    );
  };

  if (!user) {
    return <AuthForm onLogin={handleAuthLogin} onRegister={handleAuthRegister} notice={authNotice} onClearNotice={() => setAuthNotice('')} />;
  }

  const mainPlanner = (
    <div className="app-shell">
      {showAccountDropdown && (
        <div
          className="account-dropdown-backdrop"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowAccountDropdown(false);
          }}
        />
      )}
      {/* Header outside of scrollable area */}
      <div className="header">
        <div>
          <p className="title">YanPlanner</p>
          <p className="muted">
            Turn assignments and exams into a day-by-day plan. Feed it context and let the AI split the work.
          </p>
        </div>
        <div className="header-actions">
          <div className="pill info-card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <div>
                <span>Tasks</span>
                <strong style={{ marginLeft: 4 }}>{stats.total}</strong>
              </div>
              <div>
                <span>Balance</span>
                <strong style={{ marginLeft: 4 }}>${(balanceCents / 100).toFixed(2)}</strong>
              </div>
            </div>
          </div>
          <div
            className="pill account-card"
            title={`Signed in as ${user?.email || 'unknown'}. Click for options.`}
            onClick={(e) => {
              e.stopPropagation();
              setShowAccountDropdown(!showAccountDropdown);
            }}
          >
            <span role="img" aria-label="profile">👤</span>
            <div className="account-details">
              <strong>{user?.name || 'Account'}</strong>
              <span className="muted account-email">{user?.email}</span>
            </div>
            {showAccountDropdown && (
              <div 
                className="account-dropdown"
                onClick={(e) => e.stopPropagation()}
              >
                <button className="secondary" onClick={() => { setShowTopUpModal(true); setShowAccountDropdown(false); }}>
                  💳 Add funds
                </button>
                <button className="secondary" onClick={() => { navigate('/admin'); setShowAccountDropdown(false); }} title="Admin dashboard">
                  ⚙️ Admin
                </button>
                <button className="secondary" onClick={() => { handleLogout(); setShowAccountDropdown(false); }} title="Log out of this account">
                  🚪 Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content area with sidebar */}
      <div className={`app-content ${showChat ? 'with-chat-sidebar' : ''}`}>
        {/* Left sidebar with view selector */}
        <aside className="left-sidebar">
          <div className="sidebar-section">
            <p className="sidebar-title">Views</p>
            <nav className="view-selector">
              <button 
                className={`view-tab ${activeTab === 'tree' ? 'active' : ''}`} 
                onClick={() => setActiveTab('tree')}
              >
                <span className="view-icon">🌲</span>
                <span className="view-label">Tree</span>
              </button>
              <button 
                className={`view-tab ${activeTab === 'list' ? 'active' : ''}`} 
                onClick={() => setActiveTab('list')}
              >
                <span className="view-icon">📋</span>
                <span className="view-label">List</span>
              </button>
              <button 
                className={`view-tab ${activeTab === 'trash' ? 'active' : ''}`} 
                onClick={() => setActiveTab('trash')}
              >
                <span className="view-icon">🗑️</span>
                <span className="view-label">Trash</span>
              </button>
            </nav>
          </div>
          
          {/* Action buttons */}
          <div className="sidebar-section">
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button className="primary sidebar-add-button" onClick={() => setShowTaskModal(true)} style={{ flex: 1 }}>
                <span style={{ fontSize: '16px', marginRight: '6px' }}>+</span>
                Add task
              </button>
              <button 
                className={`secondary sidebar-icon-button ${showChat ? 'active-chat' : ''}`}
                onClick={() => setShowChat((v) => !v)}
                title={showChat ? 'Hide coach' : 'Show coach'}
              >
                💬
              </button>
            </div>
          </div>
          
          {/* Model and Settings at bottom */}
          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            <p className="sidebar-title">Configuration</p>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="sidebar-select"
              title={`Current model: ${modelId}`}
              style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
            >
              {modelTiers.map((tier) => {
                const modelName = tier.id.split('/').pop();
                const tierName = tier.label.split(' — ')[0];
                return (
                  <option key={tier.id} value={tier.id}>
                    {tierName} — {modelName}
                  </option>
                );
              })}
            </select>
            <button 
              className="secondary" 
              onClick={() => { setSettingsView('main'); setShowSettingsModal(true); }}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              ⚙️ Settings
            </button>
          </div>
        </aside>

        {/* Main panel */}
        <div className="panel">
          {/* Scrollable content area */}
          <div className="panel-content">
        {activeTab === 'tree' ? (
          <TaskTree
            tasks={tasks}
            onSplit={handleSplit}
            onAddSubtask={handleAddTask}
            onReorder={(newTasks) => {
              lastUserActionRef.current = Date.now();
              setTasks(newTasks);
            }}
            onDelete={(id) => {
              const ok = window.confirm('Move this task and its subtasks to trash? Attachments stay until permanently deleted.');
              if (!ok) return;
              softDeleteTask(id);
            }}
            onUpdate={handleUpdateTask}
            planningIds={planningIds}
            onEditModeChange={setIsEditingTask}
            collapsedIds={collapsedTaskIds}
            onToggleCollapsed={(id) => {
              lastUserActionRef.current = Date.now();
              setCollapsedTaskIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            }}
            userId={user?.id}
            balanceCents={balanceCents}
          />
        ) : activeTab === 'list' ? (
          <SimpleListView
            tasks={tasks}
            onSplit={handleSplit}
            onDelete={(id) => {
              const ok = window.confirm('Move this task and its subtasks to trash? Attachments stay until permanently deleted.');
              if (!ok) return;
              softDeleteTask(id);
            }}
            onUpdate={handleUpdateTask}
            planningIds={planningIds}
            onEditModeChange={setIsEditingTask}
          />
        ) : activeTab === 'trash' ? (
          <TrashCan
            items={trash}
            onRestore={(task) => restoreTask(task)}
            onDeleteForever={(id) => {
              const ok = window.confirm('Permanently delete this task and all attachments? This cannot be undone.');
              if (!ok) return;
              permanentlyDeleteFromTrash(id);
            }}
            onNavigateToPlan={() => setActiveTab('tree')}
          />
        ) : (
          <div className="settings-panel">
            {renderSettingsContent(() => setActiveTab(lastContentTabRef.current))}
          </div>
        )}
          </div> {/* End panel-content */}
        </div> {/* End panel */}
        
        {/* Desktop chat sidebar (visible on wide screens) */}
        {showChat && (
          <aside className="sidebar">
            <div className="panel">
              <ChatPanel
                messages={messages}
                onSend={handleChat}
                busy={planningIds.size > 0 || chatting}
                onClear={handleClearChat}
              />
            </div>
          </aside>
        )}
      </div> {/* End app-content */}

      {/* Mobile bottom view selector */}
      <div className="mobile-view-selector">
        <button 
          className={`view-tab ${activeTab === 'tree' ? 'active' : ''}`} 
          onClick={() => setActiveTab('tree')}
        >
          <span className="view-icon">🌲</span>
          <span className="view-label">Tree</span>
        </button>
        <button 
          className={`view-tab ${activeTab === 'list' ? 'active' : ''}`} 
          onClick={() => setActiveTab('list')}
        >
          <span className="view-icon">📋</span>
          <span className="view-label">List</span>
        </button>
        <button 
          className={`view-tab ${activeTab === 'trash' ? 'active' : ''}`} 
          onClick={() => setActiveTab('trash')}
        >
          <span className="view-icon">🗑️</span>
          <span className="view-label">Trash</span>
        </button>
        <button 
          className={`view-tab ${activeTab === 'settings' ? 'active' : ''}`} 
          onClick={() => {
            setSettingsView('main');
            setActiveTab('settings');
          }}
        >
          <span className="view-icon">⚙️</span>
          <span className="view-label">Settings</span>
        </button>
      </div>

      {!showTaskModal && (
        <button
          className="mobile-fab"
          onClick={() => setShowTaskModal(true)}
          aria-label="Add task"
        >
          +
        </button>
      )}

      {/* Footer outside scrollable area */}
      <footer>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          © {new Date().getFullYear()} YanPlanner. All rights reserved. {serverVersion && `v${serverVersion}`}
        </p>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          For bugs, feature requests, or support: <a href="mailto:ethanxucoder@gmail.com" style={{ color: '#1976d2' }}>ethanxucoder@gmail.com</a>
        </p>
      </footer>

      {/* Mobile slideover chat (hidden on desktop via CSS) */}
      <div className={`slideover ${showChat ? 'open' : ''}`}>
        <div className="slideover-panel panel">
          <ChatPanel
            messages={messages}
            onSend={handleChat}
            busy={planningIds.size > 0 || chatting}
            onClear={handleClearChat}
          />
        </div>
      </div>
      {showTaskModal && (
        <div className="modal-backdrop" onClick={() => setShowTaskModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="task-title">Add a new task</p>
            <p className="muted">Include due date and uploads. The AI will use them to split accurately.</p>
            <TaskForm userId={user?.id} balanceCents={balanceCents} onSubmit={handleAddTask} onCancel={() => setShowTaskModal(false)} />
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
      {showSettingsModal && (
        <div className="modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            {renderSettingsContent(() => setShowSettingsModal(false))}
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

  return (
    <Routes>
      <Route path="/" element={mainPlanner} />
      <Route path="/admin" element={<AdminPanel user={user} />} />
    </Routes>
  );
};

export default App;
