import type { WorkDay } from '../types';

export const WORK_DAYS: { value: WorkDay; label: string }[] = [
  { value: 'Monday', label: 'Mon' },
  { value: 'Tuesday', label: 'Tue' },
  { value: 'Wednesday', label: 'Wed' },
  { value: 'Thursday', label: 'Thu' },
  { value: 'Friday', label: 'Fri' },
  { value: 'Saturday', label: 'Sat' },
  { value: 'Sunday', label: 'Sun' }
];

const WORK_DAY_ORDER = new Map<WorkDay, number>(WORK_DAYS.map((day, index) => [day.value, index]));

export const sortWorkDays = (days?: WorkDay[]) => {
  if (!days || days.length === 0) return [];
  const unique = Array.from(new Set(days));
  return unique.sort((a, b) => (WORK_DAY_ORDER.get(a) ?? 0) - (WORK_DAY_ORDER.get(b) ?? 0));
};

export const formatWorkDays = (days?: WorkDay[], style: 'short' | 'long' = 'short') => {
  const ordered = sortWorkDays(days);
  if (ordered.length === 0) return '';
  if (style === 'long') return ordered.join(', ');
  return ordered
    .map((day) => WORK_DAYS.find((d) => d.value === day)?.label || day.slice(0, 3))
    .join(', ');
};
