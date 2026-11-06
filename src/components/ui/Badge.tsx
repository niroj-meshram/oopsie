import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'success' | 'info' | 'high' | 'medium' | 'low';

export function Badge({ tone = 'neutral', icon, children, title }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {icon}
      {children}
    </span>
  );
}
