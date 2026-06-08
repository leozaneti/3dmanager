import { AuthForm } from "./AuthForm";

type Props = {
  onLogin: () => void;
};

export function Login({ onLogin }: Props) {
  return (
    <AuthForm
      title="3D Manager"
      subtitle="Insira a senha para acessar o sistema"
      buttonLabel="Entrar"
      buttonLoadingLabel="Entrando..."
      endpoint="/api/auth/login"
      onSuccess={onLogin}
    />
  );
}
