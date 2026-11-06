import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import { ToastProvider } from '@/components/ui/Toast';
import { OopsieProvider, useOopsie } from '@/hooks/useOopsie';
import { Mascot } from '@/components/ui/Mascot';
import { ActionsProvider } from './ActionsProvider';

function Gate({ children }: { children: ReactNode }) {
  const { loading, error } = useOopsie();
  if (error) {
    return (
      <div className="boot boot--error" role="alert">
        <Mascot size={56} mood="oops" />
        <p>{error}</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="boot" aria-busy="true" aria-label="Loading Oopsie">
        <Mascot size={40} mood="calm" className="boot__mascot" />
      </div>
    );
  }
  return <>{children}</>;
}

export function mount(node: ReactNode) {
  const el = document.getElementById('root');
  if (!el) return;
  createRoot(el).render(
    <OopsieProvider>
      <ToastProvider>
        <ActionsProvider>
          <Gate>{node}</Gate>
        </ActionsProvider>
      </ToastProvider>
    </OopsieProvider>,
  );
}
