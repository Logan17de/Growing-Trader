"use client";

import { Icon } from "@/components/terminal/Icon";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, onCancel, onConfirm }: Props) {
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <div className="dialog-icon"><Icon name="shield" /></div>
      <p className="eyebrow">Execution control</p>
      <h2 id="confirm-title">{title}</h2>
      <p className="muted" id="confirm-description">{description}</p>
      <div className="dialog-actions"><button className="secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="danger" type="button" onClick={onConfirm} disabled={busy}>{busy && <Icon name="refresh" className="spin" />}{confirmLabel}</button></div>
    </section>
  </div>;
}
