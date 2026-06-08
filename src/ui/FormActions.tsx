type FormActionsProps = {
  onCancel: () => void;
  submitLabel: string;
  cancelLabel?: string;
  submitting?: boolean;
};

export function FormActions({ onCancel, submitLabel, cancelLabel = "Cancelar", submitting = false }: FormActionsProps) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "4px 0 0" }}>
      <button type="button" className="btn-order btn-order-ghost" onClick={onCancel} disabled={submitting}>{cancelLabel}</button>
      <button type="submit" className="btn-order btn-order-primary" disabled={submitting}>{submitLabel}</button>
    </div>
  );
}
