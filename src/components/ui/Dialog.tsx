import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus when opened (defaults to the first focusable). */
  initialFocusSelector?: string;
}

/**
 * Built on the native <dialog> element: modal focus trapping, Escape to
 * close and inert background come from the browser.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', initialFocusSelector }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      const target = initialFocusSelector ? el.querySelector<HTMLElement>(initialFocusSelector) : null;
      (target ?? el.querySelector<HTMLElement>('input, textarea, select, button:not(.dialog__close)'))?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialFocusSelector]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__inner">
          <header className="dialog__header">
            <div>
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              {description && <p className="dialog__desc">{description}</p>}
            </div>
            <IconButton label="Close" size="sm" className="dialog__close" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="dialog__body">{children}</div>
          {footer && <footer className="dialog__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
