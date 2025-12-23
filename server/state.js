import { prisma } from './prisma.js';

const defaults = () => ({
  tasks: [],
  chat: [],
  config: { globalInstruction: '', modelId: null },
  selectedTaskId: null
});

export const getUserState = async (userId) => {
  if (!userId) throw new Error('Missing userId');
  const state = await prisma.userState.findUnique({ where: { userId } });
  if (!state) return defaults();
  return {
    tasks: (state.tasks ?? []) ?? [],
    chat: (state.chat ?? []) ?? [],
    config: { globalInstruction: state.config?.globalInstruction || '', modelId: state.config?.modelId },
    selectedTaskId: state.selectedTaskId ?? null
  };
};

export const saveUserState = async (userId, payload) => {
  if (!userId) throw new Error('Missing userId');
  const { tasks, chat, config, selectedTaskId } = payload || {};
  const state = await prisma.userState.upsert({
    where: { userId },
    update: {
      tasks: tasks ?? [],
      chat: chat ?? [],
      config: config ?? {},
      selectedTaskId: selectedTaskId ?? null
    },
    create: {
      userId,
      tasks: tasks ?? [],
      chat: chat ?? [],
      config: config ?? {},
      selectedTaskId: selectedTaskId ?? null
    }
  });
  return {
    tasks: state.tasks ?? [],
    chat: state.chat ?? [],
    config: state.config ?? {},
    selectedTaskId: state.selectedTaskId ?? null
  };
};
