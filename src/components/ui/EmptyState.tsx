import type { ReactNode } from 'react';
import { Mascot, type MascotMood } from './Mascot';

export function EmptyState({ title, message, mood = 'calm', action, compact }: { title: string; message?: string; mood?: MascotMood; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'empty--compact' : ''}`}>
      <Mascot size={compact ? 44 : 72} mood={mood} />
      <h3 className="empty__title">{title}</h3>
      {message && <p className="empty__msg">{message}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}
