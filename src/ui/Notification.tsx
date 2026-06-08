import { CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";

type Variant = "default" | "success" | "error" | "warning";

type NotificationProps = {
  message: string;
  onClose: () => void;
  variant?: Variant;
};

const classMap: Record<Variant, string> = {
  default: "notification",
  success: "alert success",
  error: "alert error",
  warning: "alert warning",
};

const icons: Record<Variant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

export function Notification({ message, onClose, variant = "default" }: NotificationProps) {
  if (!message) return null;
  const Icon = icons[variant];
  return (
    <div className={classMap[variant]}>
      <Icon size={18} />
      <span style={{ flex: 1 }}>{message}</span>
      <button type="button" className="ghost" onClick={onClose}>Fechar</button>
    </div>
  );
}
