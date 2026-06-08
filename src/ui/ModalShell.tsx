import { type ReactNode } from "react";

type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  headerActions?: ReactNode;
  headerExtra?: ReactNode;
  maxWidth?: string;
  closeOnOverlayClick?: boolean;
  closeDisabled?: boolean;
  asForm?: boolean;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  bodyStyle?: React.CSSProperties;
};

export function ModalShell({
  open,
  onClose,
  title,
  children,
  headerActions,
  headerExtra,
  maxWidth,
  closeOnOverlayClick = true,
  closeDisabled = false,
  asForm = false,
  onSubmit,
  bodyStyle,
}: ModalShellProps) {
  if (!open) return null;

  const inner = (
    <div className="modal-order" style={maxWidth ? { maxWidth } : undefined}>
      <div className="modal-order-header">
        <div style={{ display: "flex", alignItems: "baseline", gap: "16px", flex: 1 }}>
          <h2>{title}</h2>
          {headerExtra}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {headerActions}
          <button type="button" className="modal-order-close" onClick={onClose} disabled={closeDisabled}>✕</button>
        </div>
      </div>
      {asForm ? (
        <form onSubmit={onSubmit} className="modal-order-body" style={bodyStyle}>{children}</form>
      ) : (
        <div className="modal-order-body" style={bodyStyle}>{children}</div>
      )}
    </div>
  );

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) onClose();
      }}
    >
      {inner}
    </div>
  );
}
