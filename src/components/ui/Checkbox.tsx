import { Check } from 'lucide-react';

interface TaskCheckboxProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  priority?: 'low' | 'medium' | 'high';
  size?: 'sm' | 'md';
}

/** The round, satisfying completion checkbox. */
export function TaskCheckbox({ checked, onChange, label, priority = 'medium', size = 'md' }: TaskCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`task-check task-check--${priority} task-check--${size} ${checked ? 'task-check--on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      <Check className="task-check__icon" size={size === 'sm' ? 11 : 13} strokeWidth={3.2} aria-hidden />
    </button>
  );
}
