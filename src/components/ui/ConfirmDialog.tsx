import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'default';
  /** Optional extra choice, e.g. "Also delete 2 linked reminders". */
  checkbox?: { label: string; defaultChecked: boolean };
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onCancel: () => void;
  onConfirm: (checkboxValue: boolean) => void | Promise<void>;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'danger', checkbox, onCancel, onConfirm }: ConfirmDialogProps) {
  const [checked, setChecked] = useState(checkbox?.defaultChecked ?? false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setChecked(checkbox?.defaultChecked ?? false);
  }, [open, checkbox?.defaultChecked]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      initialFocusSelector=".btn--secondary"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(checked);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="confirm__message">{message}</p>
      {checkbox && (
        <label className="confirm__check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>{checkbox.label}</span>
        </label>
      )}
    </Dialog>
  );
}
