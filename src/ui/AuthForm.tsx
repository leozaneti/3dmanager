import { useState } from "react";

type AuthFormProps = {
  title: string;
  subtitle: string;
  buttonLabel: string;
  buttonLoadingLabel: string;
  endpoint: string;
  onSuccess: () => void;
  requireConfirm?: boolean;
  minLength?: number;
};

export function AuthForm({
  title, subtitle, buttonLabel, buttonLoadingLabel,
  endpoint, onSuccess, requireConfirm, minLength,
}: AuthFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (minLength && password.length < minLength) {
      setError(`A senha deve ter no mínimo ${minLength} caracteres`);
      return;
    }
    if (requireConfirm && password !== confirm) {
      setError("As senhas não conferem");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || "Erro de autenticação");
        return;
      }
      onSuccess();
    } catch {
      setError("Erro ao conectar com o servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="boot">
      <div className="auth-box">
        <div className="auth-icon">🔐</div>
        <h2>{title}</h2>
        <p className="auth-subtitle">{subtitle}</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder={requireConfirm ? "Nova senha (mín. 4 caracteres)" : "Senha"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="auth-input"
          />
          {requireConfirm && (
            <input
              type="password"
              placeholder="Confirmar senha"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="auth-input"
            />
          )}
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-btn" disabled={loading || !password || (requireConfirm && !confirm)}>
            {loading ? buttonLoadingLabel : buttonLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
