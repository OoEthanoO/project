import { prisma } from './prisma.js';

const defaults = () => ({
  tasks: [],
  chat: [],
  trash: [],
  config: { globalInstruction: '', modelId: null, webSearchEnabled: null, collapsedTaskIds: [] },
  selectedTaskId: null
});

export const getUserState = async (userId) => {
  if (!userId) throw new Error('Missing userId');
  const state = await prisma.userState.findUnique({ where: { userId } });
  if (!state) {
    const defaults = {
      tasks: [],
      chat: [],
      trash: [],
      config: { globalInstruction: '', modelId: null, webSearchEnabled: null, collapsedTaskIds: [] },
      selectedTaskId: null,
      _explicitlyEmpty: true // Marker that this is intentionally empty (new user)
    };
    return defaults;
  }
  return {
    tasks: (state.tasks ?? []) ?? [],
    chat: (state.chat ?? []) ?? [],
    trash: (state.trash ?? []) ?? [],
    config: {
      globalInstruction: state.config?.globalInstruction || '',
      modelId: state.config?.modelId,
      webSearchEnabled: state.config?.webSearchEnabled ?? null,
      collapsedTaskIds: state.config?.collapsedTaskIds || []
    },
    selectedTaskId: state.selectedTaskId ?? null,
    _existingUser: true // Marker that this user has a state record
  };
};

export const saveUserState = async (userId, payload) => {
  if (!userId) throw new Error('Missing userId');
  const { tasks, chat, trash, config, selectedTaskId } = payload || {};
  const state = await prisma.userState.upsert({
    where: { userId },
    update: {
      tasks: tasks ?? [],
      chat: chat ?? [],
      trash: trash ?? [],
      config: config ?? {},
      selectedTaskId: selectedTaskId ?? null
    },
    create: {
      userId,
      tasks: tasks ?? [],
      chat: chat ?? [],
      trash: trash ?? [],
      config: config ?? {},
      selectedTaskId: selectedTaskId ?? null
    }
  });
  return {
    tasks: state.tasks ?? [],
    chat: state.chat ?? [],
    trash: state.trash ?? [],
    config: state.config ?? {},
    selectedTaskId: state.selectedTaskId ?? null
  };
};
