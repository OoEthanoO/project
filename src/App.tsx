import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, SyntheticEvent } from 'react';
import { Routes, Route } from 'react-router-dom';
import TaskForm from './components/TaskForm';
import TaskTree from './components/TaskTree';
import TrashCan from './components/TrashCan';
import SimpleListView from './components/SimpleListView';
import ChatPanel from './components/ChatPanel';
import AdminPanel from './components/AdminPanel';
import { ChatMessage, TaskNode } from './types';
import { addChild, findTask, randomId, removeTask, reorderWithinParent, updateTask, getR2KeysForTask, getAncestors, moveTaskToTop, moveTaskToBottom, updateAncestorStatuses } from './lib/task-utils';
import { abortAiSplit, chatWithPlanner, generateSubtasks } from './lib/ai';
import AuthForm from './components/AuthForm';
import { currentUser, login, logout, register } from './lib/auth';
import { fetchState, saveState } from './lib/state';
import { fetchBalance, topUp } from './lib/billing';
import { createCheckoutSession } from './lib/payments';
import {
  applyWebSearchSetting,
  getDefaultModel,
  getValidModelOrDefault,
  getModelById,
  hasOnlineSuffix
} from '../shared/model-config.js';
import { getAvailableBackups, restoreFromBackup, clearBackup } from './lib/backup-recovery.js';
import { formatWorkDays } from './lib/work-days';

const initialCoachMessage = () => ({
  id: randomId(),
  role: 'ai' as const,
  content:
    'I can turn assignments and tests into daily, actionable steps. Add tasks with due dates, attach materials (PDFs/images), and hit "AI split" to generate subtasks. The chat stays in sync with your plan.',
  createdAt: new Date().toISOString()
});

const pad2 = (value: number) => String(value).padStart(2, '0');
const formatDateInput = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const parseDateInput = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { value: `${match[1]}-${match[2]}-${match[3]}`, utc };
};
const resolveTodayUtc = (override?: string | null) => {
  const parsed = parseDateInput(override);
  if (parsed) return parsed.utc;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};
const resolveClientLocalDate = (override?: string | null) => {
  const parsed = parseDateInput(override);
  if (parsed) return parsed.value;
  return formatDateInput(new Date());
};

type OnboardingStep = {
  id: 'add-task' | 'create-task' | 'split-task' | 'settings';
  title: string;
  description: string;
  action: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
  getTarget: () => HTMLElement | null;
  highlightPadding?: number;
};

type SavePayload = {
  tasks: TaskNode[];
  trash: TaskNode[];
  chat: ChatMessage[];
  config: {
    globalInstruction: string;
    modelId?: string;
    webSearchEnabled?: boolean;
    collapsedTaskIds?: string[];
  };
};

type FlatListTask = TaskNode & {
  depth: number;
  order: number;
  rootTitle: string;
  ancestry: string[];
};

const isDueTodayOrPast = (dueDate?: string, todayUtc?: number) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? Date.UTC(y, m - 1, d) : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  const resolvedTodayUtc = typeof todayUtc === 'number' ? todayUtc : resolveTodayUtc(null);
  return due <= resolvedTodayUtc;
};
const isDueTomorrowOrPast = (dueDate?: string, todayUtc?: number) => {
  if (!dueDate) return false;
  const trimmed = dueDate.trim();
  if (!trimmed) return false;
  const [y, m, d] = trimmed.split('-').map((p) => parseInt(p, 10));
  const due = !Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) ? Date.UTC(y, m - 1, d) : Date.parse(trimmed);
  if (Number.isNaN(due)) return false;
  const resolvedTodayUtc = typeof todayUtc === 'number' ? todayUtc : resolveTodayUtc(null);
  const tomorrowUtc = resolvedTodayUtc + 24 * 60 * 60 * 1000;
  return due <= tomorrowUtc;
};

const copyTextToClipboard = async (text: string) => {
  if (!text) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (err) {
    console.warn('Clipboard API failed, falling back to execCommand.', err);
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
};

const buildTaskListText = (tasks: TaskNode[]) => {
  const lines: string[] = [];
  const walk = (list: TaskNode[], depth: number) => {
    (list || []).forEach((task) => {
      const indent = '  '.repeat(depth);
      const statusMark = task.status === 'done' ? '[x]' : task.status === 'in-progress' ? '[-]' : '[ ]';
      const title = task.title?.trim() || '(untitled task)';
      const metaParts: string[] = [];
      if (task.dueDate) metaParts.push(`due ${task.dueDate}`);
      if (task.startDate) metaParts.push(`start ${task.startDate}`);
      if (task.workDays?.length) metaParts.push(`work days ${formatWorkDays(task.workDays)}`);
      const attachmentCount = task.attachments?.length ?? 0;
      if (attachmentCount > 0) {
        metaParts.push(`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`);
      }
      if (task.createdBy === 'ai') metaParts.push('ai');
      const metaText = metaParts.length ? ` (${metaParts.join(', ')})` : '';
      lines.push(`${indent}- ${statusMark} ${title}${metaText}`);
      const description = (task.description || '').trim();
      if (description) {
        const formatted = description.replace(/\r?\n/g, `\n${indent}  `);
        lines.push(`${indent}  notes: ${formatted}`);
      }
      if (task.attachments?.length) {
        const names = task.attachments.map((a) => a.name || a.type || 'file').join(', ');
        lines.push(`${indent}  attachments: ${names}`);
      }
      if (task.children?.length) {
        walk(task.children, depth + 1);
      }
    });
  };
  walk(tasks, 0);
  return lines.join('\n');
};

const flattenTasksForList = (
  tasks: TaskNode[],
  depth = 0,
  orderRef = { value: 0 },
  ancestry: string[] = [],
  rootTitle?: string
): FlatListTask[] => {
  return (tasks || []).flatMap((task) => {
    const currentOrder = orderRef.value++;
    const normalizedTitle = task.title?.trim() || '(untitled task)';
    const nextAncestry = [...ancestry, task.id];
    const nextRootTitle = rootTitle ?? normalizedTitle;
    const self: FlatListTask = {
      ...task,
      title: normalizedTitle,
      depth,
      order: currentOrder,
      rootTitle: nextRootTitle,
      ancestry: nextAncestry
    };
    const children = flattenTasksForList(task.children || [], depth + 1, orderRef, nextAncestry, nextRootTitle);
    return [self, ...children];
  });
};

const compareAssociatedDueDate = (a: FlatListTask, b: FlatListTask, taskById: Map<string, FlatListTask>) => {
  const rootA = taskById.get(a.ancestry[0]);
  const rootB = taskById.get(b.ancestry[0]);
  const dueA = rootA?.dueDate;
  const dueB = rootB?.dueDate;
  if (!dueA && !dueB) return 0;
  if (!dueA) return 1;
  if (!dueB) return -1;
  return dueA.localeCompare(dueB);
};

const compareRootPlacements = (a: FlatListTask, b: FlatListTask, taskById: Map<string, FlatListTask>) => {
  const minLength = Math.min(a.ancestry.length, b.ancestry.length);
  for (let i = 0; i < minLength; i += 1) {
    const taskA = taskById.get(a.ancestry[i]);
    const taskB = taskById.get(b.ancestry[i]);
    if (!taskA || !taskB) return null;
    if (taskA.order !== taskB.order) return taskA.order - taskB.order;
  }
  return null;
};

const compareListTasks = (taskById: Map<string, FlatListTask>) => (a: FlatListTask, b: FlatListTask) => {
  if (!a.dueDate && !b.dueDate) {
    return a.order - b.order;
  }
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  const dueCmp = a.dueDate.localeCompare(b.dueDate);
  if (dueCmp !== 0) return dueCmp;
  const associatedDueCmp = compareAssociatedDueDate(a, b, taskById);
  if (associatedDueCmp !== 0) return associatedDueCmp;
  const rootPlacementCmp = compareRootPlacements(a, b, taskById);
  if (rootPlacementCmp !== null) return rootPlacementCmp;
  if (a.depth !== b.depth) return b.depth - a.depth;
  return a.order - b.order;
};

const buildListViewText = (tasks: TaskNode[]) => {
  const flat = flattenTasksForList(tasks || []);
  const taskById = new Map(flat.map((task) => [task.id, task]));
  const taskComparator = compareListTasks(taskById);
  const sorted = flat.filter((t) => t.status !== 'done').sort(taskComparator);

  const lines: string[] = [];
  sorted.forEach((task) => {
    const statusMark = task.status === 'done' ? '[x]' : task.status === 'in-progress' ? '[-]' : '[ ]';
    const metaParts: string[] = [];
    const dueLabel = task.dueDate
      ? task.startDate ? `${task.startDate} to ${task.dueDate}` : task.dueDate
      : '';
    if (dueLabel) metaParts.push(dueLabel);
    metaParts.push(`Root: ${task.rootTitle}`);
    metaParts.push(`Depth: ${task.depth}`);
    if (task.workDays?.length) metaParts.push(`Work days: ${formatWorkDays(task.workDays)}`);
    const attachmentCount = task.attachments?.length ?? 0;
    if (attachmentCount > 0) {
      metaParts.push(`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`);
    }
    if (task.createdBy === 'ai') metaParts.push('AI');
    const metaText = metaParts.length ? ` (${metaParts.join(', ')})` : '';
    lines.push(`- ${statusMark} ${task.title}${metaText}`);
    const description = (task.description || '').trim();
    if (description) {
      const formatted = description.replace(/\r?\n/g, '\n  ');
      lines.push(`  notes: ${formatted}`);
    }
    if (task.attachments?.length) {
      const names = task.attachments.map((a) => a.name || a.type || 'file').join(', ');
      lines.push(`  attachments: ${names}`);
    }
  });
  return lines.join('\n');
};

const collectCollapsibleTaskIds = (taskList: TaskNode[]) => {
  const ids: string[] = [];
  const walk = (list: TaskNode[]) => {
    list.forEach((task) => {
      if (task.children?.length) {
        ids.push(task.id);
        walk(task.children);
      }
    });
  };
  walk(taskList || []);
  return ids;
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
  const [balanceDisplayCents, setBalanceDisplayCents] = useState<number>(0);
  const [balanceDeltaCents, setBalanceDeltaCents] = useState<number | null>(null);
  const [balanceDeltaKey, setBalanceDeltaKey] = useState(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('10'); // default $10
  const [toppingUp, setToppingUp] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [isEditingTask, setIsEditingTask] = useState(false); // Track if any task is in edit mode
  const [backupAvailable, setBackupAvailable] = useState<any>(null); // Track if backup exists
  const [splitAbortNotice, setSplitAbortNotice] = useState<string | null>(null);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingTargetRect, setOnboardingTargetRect] = useState<DOMRect | null>(null);
  const onboardingTooltipRef = useRef<HTMLDivElement | null>(null);
  const [onboardingTooltipHeight, setOnboardingTooltipHeight] = useState(0);
  const [lastCreatedTaskId, setLastCreatedTaskId] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<'main' | 'backup' | 'advanced'>('main');
  const [todayOverride, setTodayOverride] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  // Track recent user-initiated mutations (e.g., rapid keyboard reorders) to avoid poll overwrites
  const lastUserActionRef = useRef(0);
  const lastSuccessfulSaveRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<{ payload: SavePayload; saveToken: number } | null>(null);
  const splitRequestRef = useRef<Map<string, number>>(new Map());
  const splitAbortRef = useRef<Map<string, { controller: AbortController; requestId: string }>>(new Map());
  const lastContentTabRef = useRef<'tree' | 'list' | 'trash'>('tree');
  const balanceCentsRef = useRef(0);
  const balanceAnimRef = useRef<number | null>(null);
  const balanceDeltaTimeoutRef = useRef<number | null>(null);
  const balanceAnimatingRef = useRef(false);
  const balanceStartTimeoutRef = useRef<number | null>(null);
  const splitAbortNoticeTimeoutRef = useRef<number | null>(null);
  // Prevent spamming version-update logs and duplicate reload timers
  const pendingReloadRef = useRef(false);
  const addTaskButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileFabRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSettingsTabRef = useRef<HTMLButtonElement | null>(null);
  const panelContentRef = useRef<HTMLDivElement | null>(null);

  const [globalInstruction, setGlobalInstruction] = useState('');
  const defaultModel = getDefaultModel().id;
  const defaultWebSearchEnabled = hasOnlineSuffix(defaultModel);
  const [modelId, setModelId] = useState(defaultModel);
  const [webSearchEnabled, setWebSearchEnabled] = useState(defaultWebSearchEnabled);
  const currentModel = getModelById(modelId);
  const hasMinBalance = balanceCents >= 50;
  const todayUtc = useMemo(() => resolveTodayUtc(todayOverride), [todayOverride]);
  const clientLocalDate = useMemo(() => resolveClientLocalDate(todayOverride), [todayOverride]);
  const latestStateRef = useRef({
    tasks,
    trash,
    messages,
    globalInstruction,
    modelId,
    webSearchEnabled,
    collapsedTaskIds
  });
  const BALANCE_DELTA_PAUSE_MS = 3000;
  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const balanceDeltaStyle = { '--balance-delta-delay': `${BALANCE_DELTA_PAUSE_MS}ms` } as CSSProperties;
  const [panelContextMenu, setPanelContextMenu] = useState<{ x: number; y: number; view: 'tree' | 'list' } | null>(null);
  const [treeFocusRequest, setTreeFocusRequest] = useState<{ id: string; token: number } | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const saveTodayOverride = (next: string | null) => {
    const parsed = parseDateInput(next);
    const value = parsed ? parsed.value : null;
    setTodayOverride(value);
    if (!user) return;
    const key = `yanplanner_today_override_${user.id}`;
    try {
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    } catch (err) {
      console.error('Failed to save date override', err);
    }
  };
  const clearBalanceDelta = () => {
    if (balanceDeltaTimeoutRef.current) {
      window.clearTimeout(balanceDeltaTimeoutRef.current);
      balanceDeltaTimeoutRef.current = null;
    }
    if (balanceStartTimeoutRef.current) {
      window.clearTimeout(balanceStartTimeoutRef.current);
      balanceStartTimeoutRef.current = null;
    }
    setBalanceDeltaCents(null);
  };
  const animateBalanceDeduction = (fromCents: number, toCents: number) => {
    if (fromCents <= toCents) {
      balanceAnimatingRef.current = false;
      setBalanceDisplayCents(toCents);
      clearBalanceDelta();
      return;
    }
    const delta = fromCents - toCents;
    clearBalanceDelta();
    setBalanceDeltaCents(delta);
    setBalanceDeltaKey((key) => key + 1);
    balanceAnimatingRef.current = true;
    if (balanceAnimRef.current) {
      cancelAnimationFrame(balanceAnimRef.current);
    }
    setBalanceDisplayCents(fromCents);
    const duration = Math.min(1800, Math.max(700, delta * 12));
    const startAnimation = () => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const current = Math.round(fromCents - delta * eased);
        setBalanceDisplayCents(current);
        if (t < 1) {
          balanceAnimRef.current = requestAnimationFrame(step);
        } else {
          balanceAnimatingRef.current = false;
          setBalanceDisplayCents(toCents);
          balanceDeltaTimeoutRef.current = window.setTimeout(() => {
            setBalanceDeltaCents(null);
          }, 900);
        }
      };
      balanceAnimRef.current = requestAnimationFrame(step);
    };
    balanceStartTimeoutRef.current = window.setTimeout(startAnimation, BALANCE_DELTA_PAUSE_MS);
  };
  
  const resolveTarget = (el: HTMLElement | null) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return el;
  };
  const onboardingSteps = useMemo<OnboardingStep[]>(() => ([
    {
      id: 'add-task',
      title: 'Add your first task',
      description: 'Create tasks with due dates, notes, and uploads in seconds.',
      action: 'Press Continue to open the task form.',
      placement: isMobile ? 'top' : 'right',
      getTarget: () => resolveTarget(isMobile ? mobileFabRef.current : addTaskButtonRef.current),
      highlightPadding: 10
    },
    {
      id: 'create-task',
      title: 'Create the task',
      description: 'Give it a title and due date so the planner can schedule it.',
      action: 'Press Continue to add a sample task.',
      placement: isMobile ? 'top' : 'right',
      getTarget: () => {
        if (typeof document === 'undefined') return null;
        return resolveTarget(document.querySelector('[data-onboarding="task-modal"]') as HTMLElement | null);
      },
      highlightPadding: 8
    },
    {
      id: 'split-task',
      title: 'Split it into steps',
      description: 'Use AI split to break a big task into actionable steps.',
      action: 'Press Continue to move on.',
      placement: isMobile ? 'top' : 'left',
      getTarget: () => {
        if (typeof document === 'undefined') return null;
        return resolveTarget(document.querySelector('[data-onboarding="split-task"]') as HTMLElement | null);
      },
      highlightPadding: 8
    },
    {
      id: 'settings',
      title: 'Settings & replay',
      description: 'Adjust global instructions and replay this walkthrough anytime.',
      action: 'Open Settings anytime to replay this tour.',
      placement: isMobile ? 'top' : 'right',
      getTarget: () => resolveTarget(isMobile ? mobileSettingsTabRef.current : settingsButtonRef.current),
      highlightPadding: 8
    }
  ]), [isMobile]);
  const totalOnboardingSteps = onboardingSteps.length;
  const currentOnboarding = totalOnboardingSteps
    ? onboardingSteps[Math.min(onboardingStep, totalOnboardingSteps - 1)]
    : null;
  const startOnboarding = () => {
    setOnboardingStep(0);
    setLastCreatedTaskId(null);
    setShowTaskModal(false);
    setShowOnboarding(true);
  };
  const completeOnboarding = () => {
    if (user) {
      try {
        localStorage.setItem(`yanplanner_onboarding_${user.id}`, '1');
      } catch (err) {
        console.error('Failed to save onboarding state', err);
      }
    }
    setShowOnboarding(false);
    setOnboardingTargetRect(null);
    setShowTaskModal(false);
  };
  const blockOnboardingInteraction = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const createSampleTask = (): TaskNode => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);
    return {
      id: randomId(),
      title: 'Sample task: History essay',
      description: 'Use AI split to turn this into daily steps.',
      dueDate: formatDateInput(dueDate),
      attachments: [],
      children: [],
      parentId: null,
      status: 'open',
      createdBy: 'user',
      createdAt: new Date().toISOString()
    };
  };
  const advanceOnboarding = () => {
    if (!showOnboarding || totalOnboardingSteps === 0 || !currentOnboarding) return;
    if (currentOnboarding.id === 'add-task') {
      setShowTaskModal(true);
      setOnboardingStep((step) => Math.min(step + 1, totalOnboardingSteps - 1));
      return;
    }
    if (currentOnboarding.id === 'create-task') {
      const hasOnboardingTask = lastCreatedTaskId ? findTask(tasks, lastCreatedTaskId) : null;
      if (!hasOnboardingTask) {
        const sampleTask = createSampleTask();
        lastUserActionRef.current = Date.now();
        setTasks((prev) => addChild(prev, null, sampleTask));
        setLastCreatedTaskId(sampleTask.id);
      }
      setShowTaskModal(false);
      setActiveTab('tree');
      setOnboardingStep((step) => Math.min(step + 1, totalOnboardingSteps - 1));
      return;
    }
    if (currentOnboarding.id === 'settings' || onboardingStep >= totalOnboardingSteps - 1) {
      completeOnboarding();
      return;
    }
    setOnboardingStep((step) => Math.min(step + 1, totalOnboardingSteps - 1));
  };
  const getTooltipPosition = (rect: DOMRect, placement: OnboardingStep['placement'], tooltipHeight = 190) => {
    const gutter = isMobile ? 16 : 12;
    const bottomSafe = isMobile ? 96 : gutter;
    const width = Math.min(320, window.innerWidth - gutter * 2);
    const height = Math.min(Math.max(tooltipHeight || 190, 160), window.innerHeight - gutter - bottomSafe);
    const availableTop = rect.top - gutter;
    const availableBottom = window.innerHeight - rect.bottom - bottomSafe;
    const availableLeft = rect.left - gutter;
    const availableRight = window.innerWidth - rect.right - gutter;
    let effectivePlacement = placement;

    if (placement === 'bottom' && availableBottom < height && availableTop > availableBottom) {
      effectivePlacement = 'top';
    } else if (placement === 'top' && availableTop < height && availableBottom > availableTop) {
      effectivePlacement = 'bottom';
    } else if (placement === 'left' && availableLeft < width && availableRight > availableLeft) {
      effectivePlacement = 'right';
    } else if (placement === 'right' && availableRight < width && availableLeft > availableRight) {
      effectivePlacement = 'left';
    }

    let top = rect.bottom + gutter;
    let left = rect.left + rect.width / 2 - width / 2;

    switch (effectivePlacement) {
      case 'top':
        top = rect.top - height - gutter;
        left = rect.left + rect.width / 2 - width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - height / 2;
        left = rect.left - width - gutter;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - height / 2;
        left = rect.right + gutter;
        break;
      case 'bottom':
      default:
        top = rect.bottom + gutter;
        left = rect.left + rect.width / 2 - width / 2;
        break;
    }

    top = Math.max(gutter, Math.min(top, window.innerHeight - height - bottomSafe));
    left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));
    return { top, left, width, placement: effectivePlacement };
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 768px)');
    const handleChange = (event?: MediaQueryListEvent) => setIsMobile(event?.matches ?? media.matches);
    handleChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    if (typeof legacyMedia.addListener === 'function') {
      legacyMedia.addListener(handleChange);
      return () => legacyMedia.removeListener?.(handleChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (!user) {
      setTodayOverride(null);
      return;
    }
    const key = `yanplanner_today_override_${user.id}`;
    try {
      const stored = localStorage.getItem(key);
      const parsed = parseDateInput(stored);
      if (parsed) {
        setTodayOverride(parsed.value);
      } else {
        setTodayOverride(null);
        if (stored) {
          localStorage.removeItem(key);
        }
      }
    } catch (err) {
      console.error('Failed to load date override', err);
      setTodayOverride(null);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!panelContextMenu) return;
    const handleOutsideClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.context-menu')) {
        setPanelContextMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelContextMenu(null);
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 0);
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [panelContextMenu]);

  useEffect(() => {
    if (!showOnboarding) {
      setOnboardingTargetRect(null);
      return;
    }
    if (totalOnboardingSteps === 0) {
      setOnboardingTargetRect(null);
      return;
    }
    if (onboardingStep >= totalOnboardingSteps) {
      setOnboardingStep(Math.max(0, totalOnboardingSteps - 1));
      return;
    }
    const updateTargetRect = () => {
      if (!currentOnboarding) {
        setOnboardingTargetRect(null);
        return;
      }
      const target = currentOnboarding.getTarget();
      if (!target) {
        setOnboardingTargetRect(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setOnboardingTargetRect(null);
        return;
      }
      setOnboardingTargetRect(rect);
    };
    updateTargetRect();
    const intervalId = window.setInterval(updateTargetRect, 200);
    window.addEventListener('resize', updateTargetRect);
    window.addEventListener('scroll', updateTargetRect, true);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', updateTargetRect);
      window.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [showOnboarding, onboardingStep, totalOnboardingSteps, currentOnboarding, activeTab, showChat, showTaskModal, showSettingsModal]);

  useLayoutEffect(() => {
    if (!showOnboarding) {
      if (onboardingTooltipHeight !== 0) setOnboardingTooltipHeight(0);
      return;
    }
    const isDocked = isMobile && currentOnboarding && (
      currentOnboarding.id === 'add-task' || currentOnboarding.id === 'create-task' || currentOnboarding.id === 'split-task'
    );
    if (isDocked) {
      if (onboardingTooltipHeight !== 0) setOnboardingTooltipHeight(0);
      return;
    }
    const el = onboardingTooltipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (Math.abs(rect.height - onboardingTooltipHeight) > 1) {
      setOnboardingTooltipHeight(rect.height);
    }
  }, [showOnboarding, onboardingStep, currentOnboarding, tasks.length, onboardingTooltipHeight, isMobile]);

  const scrollTaskIntoView = (taskId: string) => {
    const container = panelContentRef.current;
    if (!container) return false;
    const target = container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
    if (!target) return false;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offsetTop = targetRect.top - containerRect.top;
    const desiredTop = container.scrollTop + offsetTop - containerRect.height / 2 + targetRect.height / 2;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const clampedTop = Math.max(0, Math.min(desiredTop, maxScroll));
    container.scrollTo({ top: clampedTop, behavior: 'smooth' });
    return true;
  };

  const handleShowInTree = (id: string) => {
    const task = findTask(tasks, id);
    if (!task) return;
    const ancestors = getAncestors(tasks, id);
    if (ancestors.length) {
      lastUserActionRef.current = Date.now();
      setCollapsedTaskIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((ancestor) => next.delete(ancestor.id));
        return next;
      });
    }
    setActiveTab('tree');
    setTreeFocusRequest({ id, token: Date.now() });
  };

  useEffect(() => {
    setPanelContextMenu(null);
  }, [activeTab]);

  useEffect(() => {
    if (!treeFocusRequest || activeTab !== 'tree') return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 8;

    const attemptScroll = () => {
      if (cancelled) return;
      const found = scrollTaskIntoView(treeFocusRequest.id);
      if (found) {
        setHighlightedTaskId(treeFocusRequest.id);
        if (highlightTimeoutRef.current) {
          window.clearTimeout(highlightTimeoutRef.current);
        }
        highlightTimeoutRef.current = window.setTimeout(() => {
          setHighlightedTaskId((current) => (current === treeFocusRequest.id ? null : current));
          highlightTimeoutRef.current = null;
        }, 1600);
        return;
      }
      attempts += 1;
      if (attempts <= maxAttempts) {
        window.setTimeout(attemptScroll, 120);
      }
    };

    window.requestAnimationFrame(attemptScroll);
    return () => {
      cancelled = true;
    };
  }, [treeFocusRequest, activeTab]);

  useEffect(() => {
    if (activeTab !== 'settings') {
      lastContentTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    latestStateRef.current = {
      tasks,
      trash,
      messages,
      globalInstruction,
      modelId,
      webSearchEnabled,
      collapsedTaskIds
    };
  }, [tasks, trash, messages, globalInstruction, modelId, webSearchEnabled, collapsedTaskIds]);

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
        setWebSearchEnabled(defaultWebSearchEnabled);
        setShowOnboarding(false);
        setOnboardingStep(0);
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
            enqueueSave({
              tasks: localBackup.tasks,
              trash: localBackup.trash || []
            });
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
        const resolvedModelId = getValidModelOrDefault(loadedModelId);
        const persistedWebSearch = state.config?.webSearchEnabled;
        const resolvedWebSearchEnabled =
          typeof persistedWebSearch === 'boolean' ? persistedWebSearch : hasOnlineSuffix(resolvedModelId);
        const adjustedModelId = applyWebSearchSetting(resolvedModelId, resolvedWebSearchEnabled);
        setWebSearchEnabled(resolvedWebSearchEnabled);
        setModelId(getValidModelOrDefault(adjustedModelId));
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
    balanceCentsRef.current = balanceCents;
    if (!balanceAnimatingRef.current) {
      setBalanceDisplayCents(balanceCents);
    }
  }, [balanceCents]);

  useEffect(() => {
    return () => {
      if (balanceAnimRef.current) cancelAnimationFrame(balanceAnimRef.current);
      if (balanceDeltaTimeoutRef.current) window.clearTimeout(balanceDeltaTimeoutRef.current);
      if (balanceStartTimeoutRef.current) window.clearTimeout(balanceStartTimeoutRef.current);
    };
  }, []);

  const buildSavePayload = (overrides: Partial<SavePayload> = {}): SavePayload => {
    const base = latestStateRef.current;
    const configOverride: Partial<SavePayload['config']> = overrides.config ?? {};
    return {
      tasks: overrides.tasks ?? base.tasks,
      trash: overrides.trash ?? base.trash,
      chat: overrides.chat ?? base.messages,
      config: {
        globalInstruction: configOverride.globalInstruction ?? base.globalInstruction,
        modelId: configOverride.modelId ?? base.modelId,
        webSearchEnabled: configOverride.webSearchEnabled ?? base.webSearchEnabled,
        collapsedTaskIds: configOverride.collapsedTaskIds ?? Array.from(base.collapsedTaskIds)
      }
    };
  };

  const flushSaveQueue = async (userId: string) => {
    if (saveInFlightRef.current || !pendingSaveRef.current) return;
    const nextSave = pendingSaveRef.current;
    pendingSaveRef.current = null;
    saveInFlightRef.current = true;
    try {
      await saveState(userId, nextSave.payload);
      if (lastUserActionRef.current === nextSave.saveToken) {
        lastSuccessfulSaveRef.current = nextSave.saveToken;
      }
    } catch (err) {
      console.error('Failed to save state', err);
    } finally {
      saveInFlightRef.current = false;
      if (pendingSaveRef.current) {
        void flushSaveQueue(userId);
      }
    }
  };

  const enqueueSave = (overrides: Partial<SavePayload> = {}, saveToken = lastUserActionRef.current) => {
    if (!user) return;
    pendingSaveRef.current = { payload: buildSavePayload(overrides), saveToken };
    void flushSaveQueue(user.id);
  };

  useEffect(() => {
    if (!user || !hydrated) return;
    const saveToken = lastUserActionRef.current;
    const timer = setTimeout(() => {
      enqueueSave({
        tasks,
        trash,
        chat: messages,
        config: { globalInstruction, modelId, webSearchEnabled, collapsedTaskIds: Array.from(collapsedTaskIds) }
      }, saveToken);
    }, 300);
    return () => clearTimeout(timer);
  }, [user, hydrated, tasks, trash, messages, globalInstruction, modelId, webSearchEnabled, collapsedTaskIds]);

  useEffect(() => {
    if (!user || !hydrated) return;
    try {
      const key = `yanplanner_onboarding_${user.id}`;
      const seen = localStorage.getItem(key);
      if (!seen) {
        setOnboardingStep(0);
        setLastCreatedTaskId(null);
        setShowTaskModal(false);
        setShowOnboarding(true);
      }
    } catch (err) {
      console.error('Failed to load onboarding state', err);
    }
  }, [user, hydrated]);

  useEffect(() => {
    if (!showOnboarding || !currentOnboarding) return;
    if (currentOnboarding.id === 'create-task') {
      if (tasks.length === 0 && !showTaskModal) {
        setShowTaskModal(true);
      }
      return;
    }
    if (showTaskModal) {
      setShowTaskModal(false);
    }
    if (currentOnboarding.id === 'split-task' && activeTab !== 'tree') {
      setActiveTab('tree');
    }
  }, [showOnboarding, currentOnboarding, tasks.length, showTaskModal, activeTab]);

  useEffect(() => {
    if (!showOnboarding || currentOnboarding?.id !== 'split-task') return;
    if (tasks.length > 0) return;
    const sampleTask = createSampleTask();
    lastUserActionRef.current = Date.now();
    setTasks((prev) => addChild(prev, null, sampleTask));
    setLastCreatedTaskId(sampleTask.id);
  }, [showOnboarding, currentOnboarding, tasks.length]);

  const onboardingSplitTaskId = useMemo(() => {
    if (lastCreatedTaskId && findTask(tasks, lastCreatedTaskId)) return lastCreatedTaskId;
    return tasks[0]?.id ?? null;
  }, [lastCreatedTaskId, tasks]);

  useEffect(() => {
    if (!showOnboarding || currentOnboarding?.id !== 'split-task') return;
    if (!onboardingSplitTaskId) return;
    if (planningIds.has(onboardingSplitTaskId)) return;
    const target = findTask(tasks, onboardingSplitTaskId);
    const hasAiChildren = (target?.children || []).some((child) => child.createdBy === 'ai');
    if (!hasAiChildren) return;
    setOnboardingStep((step) => Math.min(step + 1, totalOnboardingSteps - 1));
  }, [showOnboarding, currentOnboarding, onboardingSplitTaskId, planningIds, tasks, totalOnboardingSteps]);

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
        const hasPendingLocalChanges = lastUserActionRef.current > lastSuccessfulSaveRef.current;
        // Only update tasks if they actually changed
        if (!hasPendingLocalChanges) {
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
        }
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
        const resolvedModelId = getValidModelOrDefault(newModelId);
        const persistedWebSearch = state.config?.webSearchEnabled;
        const newWebSearchEnabled =
          typeof persistedWebSearch === 'boolean' ? persistedWebSearch : hasOnlineSuffix(resolvedModelId);
        const adjustedModelId = applyWebSearchSetting(resolvedModelId, newWebSearchEnabled);
        const validatedModelId = getValidModelOrDefault(adjustedModelId);
        // Type collapsed IDs explicitly to avoid Set<unknown>
        const newCollapsedIds: Set<string> = new Set<string>((state.config?.collapsedTaskIds || []) as string[]);
        setGlobalInstruction((prev) => prev === newInstruction ? prev : newInstruction);
        setWebSearchEnabled((prev) => prev === newWebSearchEnabled ? prev : newWebSearchEnabled);
        setModelId((prev) => prev === validatedModelId ? prev : validatedModelId);
        if (startedAt < lastUserActionRef.current || hasPendingLocalChanges) {
          // Skip collapsed-id update if user interacted after this poll started or local changes are pending
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
    setShowOnboarding(false);
    setOnboardingStep(0);
    setLastCreatedTaskId(null);
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

      if (showOnboarding) {
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape' || e.key === 'Esc' || e.key === 'esc') {
        if (showTaskModal || showInstructionModal || showSettingsModal) {
          e.preventDefault();
          if (showTaskModal) {
            closeTaskModal();
          }
          setShowInstructionModal(false);
          setShowSettingsModal(false);
        }
        return;
      }

      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          if (showOnboarding && currentOnboarding?.id === 'add-task') {
            advanceOnboarding();
            break;
          }
          setShowTaskModal(true);
          break;
        case 'g':
          e.preventDefault();
          setShowInstructionModal(true);
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
  }, [showTaskModal, showInstructionModal, showSettingsModal, activeTab, showOnboarding, currentOnboarding, user]);

  useEffect(() => {
    if (!showOnboarding || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showOnboarding]);

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
      dueByTomorrow: all.filter((t) => isDueTomorrowOrPast(t.dueDate, todayUtc)).length,
      hasContext: all.some((t) => t.attachments.length > 0 || t.description)
    };
  }, [tasks, todayUtc]);

  const handleCopyTasks = async (view: 'tree' | 'list') => {
    const text = view === 'list' ? buildListViewText(tasks) : buildTaskListText(tasks);
    if (!text.trim()) return;
    try {
      await copyTextToClipboard(text);
    } catch (err) {
      console.error('Copy tasks failed', err);
    }
  };

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const collapseAllTasks = () => {
    const allCollapsibleIds = collectCollapsibleTaskIds(tasks);
    lastUserActionRef.current = Date.now();
    setCollapsedTaskIds(new Set(allCollapsibleIds));
  };

  const handleAddTask = (task: TaskNode) => {
    lastUserActionRef.current = Date.now();
    setTasks((prev) => addChild(prev, task.parentId ?? null, task));
    setLastCreatedTaskId(task.id);
    setShowTaskModal(false);
    if (showOnboarding && currentOnboarding?.id === 'create-task' && !task.parentId) {
      setActiveTab('tree');
      setOnboardingStep((step) => Math.min(step + 1, totalOnboardingSteps - 1));
    }
  };

  const closeTaskModal = () => {
    setShowTaskModal(false);
    if (showOnboarding && currentOnboarding?.id === 'create-task') {
      setOnboardingStep(0);
    }
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
    setTasks((prev) => {
      const next = updateTask(prev, id, (t) => ({
        ...t,
        ...updates
      }));
      if (!updates.status) return next;
      return updateAncestorStatuses(next, id);
    });
  };

  const handleClearAiSubtasks = (parentId: string) => {
    const parent = findTask(tasks, parentId);
    if (!parent) return;
    const aiChildren = (parent.children || []).filter((child) => child.createdBy === 'ai');
    if (aiChildren.length === 0) return;
    splitRequestRef.current.set(parentId, Date.now());
    setPlanningIds((prev) => {
      if (!prev.has(parentId)) return prev;
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
    lastUserActionRef.current = Date.now();
    const deletedAt = new Date().toISOString();
    const trashedCopies = aiChildren.map((child) => {
      const copy = typeof structuredClone === 'function' ? structuredClone(child) : (JSON.parse(JSON.stringify(child)) as TaskNode);
      return {
        ...copy,
        deletedAt,
        trashedFromParentId: parentId
      };
    });
    setTasks((prev) =>
      updateTask(prev, parentId, (t) => ({
        ...t,
        children: (t.children || []).filter((child) => child.createdBy !== 'ai')
      }))
    );
    setTrash((prev) => [...trashedCopies, ...prev]);
  };

  const handleSplit = async (id: string) => {
    const task = findTask(tasks, id);
    if (!task) return;
    if (!user) return;
    if (!hasMinBalance) {
      alert('Minimum balance of $0.50 required to use AI features. Please add funds to continue.');
      return;
    }
    const balanceBeforeSplit = balanceCentsRef.current;
    if (isDueTodayOrPast(task.dueDate, todayUtc)) {
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
    const splitToken = Date.now();
    splitRequestRef.current.set(id, splitToken);
    const splitRequestId = randomId();
    const controller = new AbortController();
    splitAbortRef.current.set(id, { controller, requestId: splitRequestId });
    try {
      const ancestors = getAncestors(tasks, id);
      const subtasks = await generateSubtasks({
        task,
        ancestors,
        conversation: messages,
        globalInstruction,
        modelId,
        webSearchEnabled,
        splitRequestId,
        abortSignal: controller.signal,
        userId: user.id,
        clientLocalDate
      });
      if (splitRequestRef.current.get(id) !== splitToken) return;
      lastUserActionRef.current = Date.now();
      setTasks((prev) =>
        updateTask(prev, id, (t) => ({
          ...t,
          children: [...(t.children || []), ...subtasks]
        }))
      );
      if (splitRequestRef.current.get(id) === splitToken) {
        try {
          const updatedBalance = await fetchBalance(user.id);
          if (splitRequestRef.current.get(id) !== splitToken) return;
          setBalanceCents((prev) => (prev === updatedBalance ? prev : updatedBalance));
          if (updatedBalance < balanceBeforeSplit) {
            animateBalanceDeduction(balanceBeforeSplit, updatedBalance);
          } else {
            setBalanceDisplayCents(updatedBalance);
            clearBalanceDelta();
          }
        } catch (e) {
          console.error('Failed to refresh balance after split', e);
        }
      }
    } catch (err) {
      if (splitRequestRef.current.get(id) === splitToken) {
        if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
          // User-initiated abort; no error alert needed.
          return;
        }
        console.error('AI split failed', err);
        alert(`AI split failed: ${err instanceof Error ? err.message : 'Please try again.'}`);
      }
    } finally {
      setPlanningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (splitRequestRef.current.get(id) === splitToken) {
        splitRequestRef.current.delete(id);
      }
      splitAbortRef.current.delete(id);
    }
  };

  const handleAbortSplit = async (id: string) => {
    if (!user) return;
    const entry = splitAbortRef.current.get(id);
    if (!entry) return;
    const confirmed = window.confirm('Abort AI split? Funds are still deducted for any work performed.');
    if (!confirmed) return;
    if (splitAbortNoticeTimeoutRef.current) {
      window.clearTimeout(splitAbortNoticeTimeoutRef.current);
    }
    entry.controller.abort();
    splitAbortRef.current.delete(id);
    splitRequestRef.current.delete(id);
    setPlanningIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      await abortAiSplit({ splitRequestId: entry.requestId, userId: user.id });
    } catch (err) {
      console.warn('Failed to notify server about split abort', err);
    }
    setSplitAbortNotice('Funds are still deducted for any work performed.');
    splitAbortNoticeTimeoutRef.current = window.setTimeout(() => {
      setSplitAbortNotice(null);
    }, 8000);
  };

  const handleChat = async (text: string) => {
    if (!user) return;
    if (!hasMinBalance) {
      const errorMsg: ChatMessage = {
        id: randomId(),
        role: 'ai',
        content: 'Minimum balance of $0.50 required to use AI features. Please add funds to continue.',
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, errorMsg]);
      return;
    }
    const userMsg: ChatMessage = { id: randomId(), role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setChatting(true);
    try {
      const aiMessage = await chatWithPlanner(text, tasks, globalInstruction, null, modelId, user.id, clientLocalDate, webSearchEnabled);
      setMessages((prev) => [...prev, aiMessage]);
      // Persist chat immediately to reduce chance of losing the last response
      const baseMessages = latestStateRef.current.messages;
      const chatLog = baseMessages.some((msg) => msg.id === userMsg.id)
        ? [...baseMessages, aiMessage]
        : [...baseMessages, userMsg, aiMessage];
      enqueueSave({ chat: chatLog });
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

  const handleClearChat = () => {
    if (!user) return;
    const clearedMessages = [initialCoachMessage()];
    setMessages(clearedMessages);
    // Immediately save to server to prevent polling from restoring old messages
    enqueueSave({ chat: clearedMessages });
  };

  const openAdvancedSettings = () => {
    setSettingsView('advanced');
    if (isMobile) {
      setActiveTab('settings');
    } else {
      setShowSettingsModal(true);
    }
  };

  const updateWebSearchSetting = (enabled: boolean) => {
    const saveToken = Date.now();
    const updatedModelId = getValidModelOrDefault(applyWebSearchSetting(modelId, enabled));
    lastUserActionRef.current = saveToken;
    setWebSearchEnabled(enabled);
    setModelId(updatedModelId);
    enqueueSave({ config: { globalInstruction, webSearchEnabled: enabled, modelId: updatedModelId } }, saveToken);
  };

  const renderSettingsContent = (onDone: () => void) => {
    const closeSettings = () => {
      setSettingsView('main');
      onDone();
    };

    if (settingsView === 'advanced') {
      const deviceLocalDate = formatDateInput(new Date());
      return (
        <>
          <p className="task-title">Advanced settings</p>
          <p className="muted">Power controls for fine-tuning this client.</p>
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Override today&apos;s date</p>
            <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
              Changes the date used for due checks and AI planning on this device.
            </p>
            {todayOverride ? (
              <div className="override-banner" role="status">
                <strong>Date override active</strong>
                <span>Today is set to {todayOverride} on this device.</span>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12, marginBottom: 'var(--space-sm)' }}>
                Using device date ({deviceLocalDate}).
              </p>
            )}
            <label className="muted">Override date</label>
            <input
              type="date"
              value={todayOverride ?? ''}
              onChange={(e) => saveTodayOverride(e.target.value || null)}
            />
            <div className="task-actions" style={{ marginTop: 12 }}>
              <button className="secondary" onClick={() => saveTodayOverride(null)} disabled={!todayOverride}>
                Clear override
              </button>
            </div>
          </div>
          <div className="task-actions">
            <button className="secondary" onClick={() => setSettingsView('main')}>
              ← Back
            </button>
          </div>
        </>
      );
    }

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
                  enqueueSave({ tasks: restored.tasks, trash: restored.trash });
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
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Web search for AI</p>
          <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
            Let the model use the internet for current details and curriculum references.
          </p>
          <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
            Enabling web search may slightly increase costs.
          </p>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={webSearchEnabled}
              onChange={(e) => updateWebSearchSetting(e.target.checked)}
            />
            <span>Enable web search</span>
          </label>
        </div>
        
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Onboarding</p>
          <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
            Replay the guided walkthrough of YanPlanner features.
          </p>
          <button
            className="secondary"
            onClick={() => {
              startOnboarding();
              setShowSettingsModal(false);
            }}
          >
            ✨ Replay onboarding
          </button>
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
                    enqueueSave({ tasks: restored.tasks, trash: restored.trash });
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

        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Advanced settings</p>
          <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
            Power options for testing and diagnostics.
          </p>
          {todayOverride && (
            <div className="override-banner" role="status">
              <strong>Date override active</strong>
              <span>Today is set to {todayOverride} on this device.</span>
            </div>
          )}
          <button className="secondary" onClick={() => setSettingsView('advanced')}>
            🧪 Open advanced settings
          </button>
        </div>

        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>About</p>
          <div className="settings-about">
            <div className="settings-about-row">
              <span className="muted">© {new Date().getFullYear()} YanPlanner</span>
              <span className="muted">All rights reserved.</span>
            </div>
            <div className="settings-about-row">
              <span className="muted">Version</span>
              <span>{serverVersion ? `v${serverVersion}` : '—'}</span>
            </div>
            <div className="settings-about-row">
              <span className="muted">Support</span>
              <a href="mailto:ethanxucoder@gmail.com">ethanxucoder@gmail.com</a>
            </div>
            <div className="settings-about-row">
              <span className="muted">AI model</span>
              <span>{currentModel?.label || modelId}</span>
            </div>
          </div>
        </div>

      </>
    );
  };

  if (!user) {
    return <AuthForm onLogin={handleAuthLogin} onRegister={handleAuthRegister} notice={authNotice} onClearNotice={() => setAuthNotice('')} />;
  }
  if (!hydrated) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-spinner" aria-hidden="true" />
          <p className="title">Loading your planner</p>
          <p className="muted">Fetching tasks...</p>
        </div>
      </div>
    );
  }

  const onboardingStepNumber = totalOnboardingSteps
    ? Math.min(onboardingStep + 1, totalOnboardingSteps)
    : 0;
  const safeOnboardingIndex = totalOnboardingSteps
    ? Math.min(onboardingStep, totalOnboardingSteps - 1)
    : 0;
  const onboardingIsSplitStep = showOnboarding && currentOnboarding?.id === 'split-task';
  const desiredTooltipPlacement = currentOnboarding?.placement ?? 'bottom';
  const highlightPadding = currentOnboarding?.highlightPadding ?? 8;
  const spotlightStyle = onboardingTargetRect
    ? {
        top: Math.max(0, onboardingTargetRect.top - highlightPadding),
        left: Math.max(0, onboardingTargetRect.left - highlightPadding),
        width: onboardingTargetRect.width + highlightPadding * 2,
        height: onboardingTargetRect.height + highlightPadding * 2
      }
    : undefined;
  const tooltipPosition = showOnboarding && currentOnboarding && onboardingTargetRect && typeof window !== 'undefined'
    ? getTooltipPosition(onboardingTargetRect, desiredTooltipPlacement, onboardingTooltipHeight)
    : null;
  const tooltipPlacement = tooltipPosition?.placement ?? (spotlightStyle ? desiredTooltipPlacement : 'center');
  const tooltipMaxHeight = typeof window !== 'undefined'
    ? window.innerHeight - (isMobile ? 140 : 24)
    : undefined;
  const tooltipStyle = tooltipPosition
    ? { top: tooltipPosition.top, left: tooltipPosition.left, width: tooltipPosition.width, maxHeight: tooltipMaxHeight }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(320px, calc(100vw - 24px))', maxHeight: tooltipMaxHeight };
  const showEmptyTasks = tasks.length === 0 && (activeTab === 'tree' || activeTab === 'list');
  const useDockedOnboarding = showOnboarding && isMobile && currentOnboarding && (
    currentOnboarding.id === 'add-task' || currentOnboarding.id === 'create-task' || currentOnboarding.id === 'split-task'
  );
  const dockPlacement: 'top' | 'bottom' = 'top';
  const shouldPadModalForDock = useDockedOnboarding && currentOnboarding?.id === 'create-task';
  const emptyTasksState = (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>📝</div>
      <p className="title" style={{ fontSize: 22, margin: '8px 0 6px' }}>No tasks yet</p>
      <p className="muted" style={{ maxWidth: 520 }}>
        Add a task to start building your day-by-day plan. Include due dates to get the best splits.
      </p>
      <div className="empty-actions">
        <button
          className="primary"
          onClick={() => {
            if (showOnboarding && currentOnboarding?.id === 'add-task') {
              advanceOnboarding();
              return;
            }
            setShowTaskModal(true);
          }}
        >
          Add task
        </button>
      </div>
    </div>
  );

  const onboardingCardContent = (
    <>
      <div className="onboarding-header">
        <span className="onboarding-step">
          Step {onboardingStepNumber} of {totalOnboardingSteps}
        </span>
        <div className="onboarding-progress" aria-hidden="true">
          {onboardingSteps.map((step, idx) => (
            <span
              key={`onboarding-dot-${step.id}`}
              className={`onboarding-dot ${idx <= safeOnboardingIndex ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
      <p className="onboarding-title">{currentOnboarding?.title}</p>
      <p className="muted onboarding-text">{currentOnboarding?.description}</p>
      <p className="onboarding-action">{currentOnboarding?.action}</p>
      <div className="onboarding-actions">
        <button className="secondary" onClick={completeOnboarding}>
          Skip
        </button>
        <div className="onboarding-actions-right">
          {safeOnboardingIndex > 0 && (
            <button
              className="secondary"
              onClick={() => setOnboardingStep((step) => Math.max(0, step - 1))}
            >
              Back
            </button>
          )}
          <button className="primary" onClick={advanceOnboarding}>
            {safeOnboardingIndex >= totalOnboardingSteps - 1 ? 'Finish' : 'Continue'}
          </button>
        </div>
      </div>
    </>
  );

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
                <strong style={{ marginLeft: 4 }}>{stats.dueByTomorrow}/{stats.total}</strong>
              </div>
              <div className="balance-row">
                <span>Balance</span>
                <div className="balance-amount">
                  <strong>{formatCurrency(balanceDisplayCents)}</strong>
                  {balanceDeltaCents !== null && (
                    <span key={balanceDeltaKey} className="balance-delta" style={balanceDeltaStyle}>
                      -{formatCurrency(balanceDeltaCents)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div
            className="pill account-card"
            title={`Signed in as ${user?.email || 'unknown'}. Click for options.`}
            onClick={(e) => {
              e.stopPropagation();
              setShowAccountDropdown((prev) => !prev);
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
                <button className="secondary" onClick={() => { handleLogout(); setShowAccountDropdown(false); }} title="Log out of this account">
                  🚪 Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {todayOverride && (
        <div className="override-banner app-override-banner" role="status">
          <div className="override-banner-text">
            <strong>Date override active</strong>
            <span>Today is set to {todayOverride} on this device.</span>
          </div>
          <button className="secondary" onClick={openAdvancedSettings}>
            Manage
          </button>
        </div>
      )}
      {splitAbortNotice && (
        <div className="override-banner app-override-banner" role="status">
          <div className="override-banner-text">
            <strong>AI split aborted</strong>
            <span>{splitAbortNotice}</span>
          </div>
          <button
            className="secondary"
            onClick={() => {
              if (splitAbortNoticeTimeoutRef.current) {
                window.clearTimeout(splitAbortNoticeTimeoutRef.current);
              }
              setSplitAbortNotice(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content area with sidebar */}
      <div className={`app-content ${showChat ? 'with-chat-sidebar' : ''}`}>
        {/* Left sidebar with view selector */}
        <aside className="left-sidebar">
          <div className="sidebar-section">
            <p className="sidebar-title">Views</p>
            <nav className="view-selector">
              <button 
                className={`view-tab ${activeTab === 'tree' ? 'active' : ''}`} 
                onClick={() => {
                  setActiveTab('tree');
                }}
              >
                <span className="view-icon">🌲</span>
                <span className="view-label">Tree</span>
              </button>
              <button 
                className={`view-tab ${activeTab === 'list' ? 'active' : ''}`} 
                onClick={() => {
                  setActiveTab('list');
                }}
              >
                <span className="view-icon">📋</span>
                <span className="view-label">List</span>
              </button>
              <button 
                className={`view-tab ${activeTab === 'trash' ? 'active' : ''}`} 
                onClick={() => {
                  setActiveTab('trash');
                }}
              >
                <span className="view-icon">🗑️</span>
                <span className="view-label">Trash</span>
              </button>
            </nav>
          </div>
          
          {/* Action buttons */}
          <div className="sidebar-section">
            <button
              className="primary sidebar-add-button"
              ref={addTaskButtonRef}
              onClick={() => {
                if (showOnboarding && currentOnboarding?.id === 'add-task') {
                  advanceOnboarding();
                  return;
                }
                setShowTaskModal(true);
              }}
              style={{ width: '100%' }}
            >
              <span style={{ fontSize: '16px', marginRight: '6px' }}>+</span>
              Add task
            </button>
          </div>
          
          {/* Settings at bottom */}
          <div className="sidebar-section" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button 
              className="secondary" 
              ref={settingsButtonRef}
              onClick={() => {
                setSettingsView('main');
                setShowSettingsModal(true);
              }}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              ⚙️ Settings
            </button>
          </div>
        </aside>

        {/* Main panel */}
        <div
          className="panel"
          onContextMenu={(e) => {
            if (activeTab !== 'tree' && activeTab !== 'list') return;
            const target = e.target as HTMLElement | null;
            if (target && (target.closest('input, textarea, select, button') || target.closest('.task-card'))) {
              return;
            }
            e.preventDefault();
            setPanelContextMenu({ x: e.clientX, y: e.clientY, view: activeTab });
          }}
        >
          {/* Scrollable content area */}
          <div className="panel-content" ref={panelContentRef}>
        {activeTab === 'tree' ? (
          showEmptyTasks ? (
            emptyTasksState
          ) : (
            <TaskTree
              tasks={tasks}
              onSplit={handleSplit}
              onAbortSplit={handleAbortSplit}
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
              highlightedTaskId={highlightedTaskId}
              userId={user?.id}
              balanceCents={balanceCents}
              todayUtc={todayUtc}
              onboardingSplitTaskId={showOnboarding ? onboardingSplitTaskId : null}
              onboardingShowSplit={onboardingIsSplitStep}
              onClearAiSubtasks={handleClearAiSubtasks}
            />
          )
        ) : activeTab === 'list' ? (
          showEmptyTasks ? (
            emptyTasksState
          ) : (
            <SimpleListView
              tasks={tasks}
              onSplit={handleSplit}
              onAbortSplit={handleAbortSplit}
              onDelete={(id) => {
                const ok = window.confirm('Move this task and its subtasks to trash? Attachments stay until permanently deleted.');
                if (!ok) return;
                softDeleteTask(id);
              }}
              onUpdate={handleUpdateTask}
              planningIds={planningIds}
              onEditModeChange={setIsEditingTask}
              onShowInTree={handleShowInTree}
              userId={user?.id}
              balanceCents={balanceCents}
              todayUtc={todayUtc}
            />
          )
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

      {panelContextMenu && createPortal(
        <>
          <div className="context-menu-backdrop" onClick={() => setPanelContextMenu(null)} />
          <div
            className="context-menu"
            style={{
              position: 'fixed',
              left: `${Math.min(panelContextMenu.x, window.innerWidth - 220)}px`,
              top: `${Math.min(panelContextMenu.y, window.innerHeight - 140)}px`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {panelContextMenu.view === 'tree' && (
              <button
                className="context-menu-item"
                onClick={() => {
                  setPanelContextMenu(null);
                  collapseAllTasks();
                }}
                disabled={tasks.length === 0}
                title={tasks.length === 0 ? 'No tasks to collapse.' : 'Collapse all tasks in the tree view'}
              >
                Collapse all tasks
              </button>
            )}
            <button
              className="context-menu-item"
              onClick={() => {
                setPanelContextMenu(null);
                handleCopyTasks(panelContextMenu.view);
              }}
              disabled={stats.total === 0}
              title={stats.total === 0 ? 'No tasks to copy.' : 'Copy tasks to clipboard.'}
            >
              📋 Copy tasks
            </button>
          </div>
        </>,
        document.body
      )}

      {/* Mobile bottom view selector */}
      <div className="mobile-view-selector">
        <button 
          className={`view-tab ${activeTab === 'tree' ? 'active' : ''}`} 
          onClick={() => {
            setActiveTab('tree');
          }}
        >
          <span className="view-icon">🌲</span>
          <span className="view-label">Tree</span>
        </button>
        <button 
          className={`view-tab ${activeTab === 'list' ? 'active' : ''}`} 
          onClick={() => {
            setActiveTab('list');
          }}
        >
          <span className="view-icon">📋</span>
          <span className="view-label">List</span>
        </button>
        <button 
          className={`view-tab ${activeTab === 'trash' ? 'active' : ''}`} 
          onClick={() => {
            setActiveTab('trash');
          }}
        >
          <span className="view-icon">🗑️</span>
          <span className="view-label">Trash</span>
        </button>
        <button 
          className={`view-tab ${activeTab === 'settings' ? 'active' : ''}`} 
          ref={mobileSettingsTabRef}
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
          ref={mobileFabRef}
          onClick={() => {
            if (showOnboarding && currentOnboarding?.id === 'add-task') {
              advanceOnboarding();
              return;
            }
            setShowTaskModal(true);
          }}
          aria-label="Add task"
        >
          +
        </button>
      )}

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
        <div className={`modal-backdrop ${shouldPadModalForDock ? 'onboarding-docked' : ''}`} onClick={closeTaskModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-onboarding="task-modal">
            <p className="task-title">Add a new task</p>
            <p className="muted">Include due date and uploads. The AI will use them to split accurately.</p>
            <TaskForm userId={user?.id} balanceCents={balanceCents} onSubmit={handleAddTask} onCancel={closeTaskModal} />
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
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
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
              No refunds.
            </p>
          </div>
        </div>
      )}
      {showOnboarding && currentOnboarding && (
        <>
          <div
            className="onboarding-overlay"
            aria-hidden="true"
            onClick={blockOnboardingInteraction}
            onMouseDown={blockOnboardingInteraction}
            onTouchStart={blockOnboardingInteraction}
            onTouchMove={blockOnboardingInteraction}
            onWheel={blockOnboardingInteraction}
          >
            {spotlightStyle && (
              <div className="onboarding-spotlight" style={spotlightStyle} />
            )}
          </div>
          {useDockedOnboarding ? (
            <div
              className={`onboarding-dock ${dockPlacement === 'top' ? 'dock-top' : 'dock-bottom'}`}
              role="dialog"
              aria-live="polite"
            >
              {onboardingCardContent}
            </div>
          ) : (
            <div
              className="onboarding-tooltip"
              ref={onboardingTooltipRef}
              role="dialog"
              aria-live="polite"
              data-placement={tooltipPlacement}
              style={tooltipStyle}
            >
              <span className="onboarding-arrow" aria-hidden="true" />
              {onboardingCardContent}
            </div>
          )}
        </>
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
