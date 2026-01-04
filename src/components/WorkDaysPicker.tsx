import type { WorkDay } from '../types';
import { WORK_DAYS, sortWorkDays } from '../lib/work-days';

type Props = {
  value?: WorkDay[];
  onChange: (days?: WorkDay[]) => void;
};

const WorkDaysPicker = ({ value = [], onChange }: Props) => {
  const selected = new Set(value);

  const handleToggle = (day: WorkDay) => {
    const next = new Set(selected);
    if (next.has(day)) {
      next.delete(day);
    } else {
      next.add(day);
    }
    const ordered = sortWorkDays(Array.from(next));
    onChange(ordered.length ? ordered : undefined);
  };

  const handleClear = () => onChange(undefined);

  return (
    <div className="workday-picker">
      <div className="chips workday-chips">
        {WORK_DAYS.map((day) => {
          const isSelected = selected.has(day.value);
          return (
            <button
              key={day.value}
              type="button"
              className={`chip workday-chip ${isSelected ? 'chip-selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => handleToggle(day.value)}
            >
              {day.label}
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <button type="button" className="subtle workday-clear" onClick={handleClear}>
          Clear
        </button>
      )}
    </div>
  );
};

export default WorkDaysPicker;
