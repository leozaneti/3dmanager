import { AuthForm } from "./AuthForm";

type Props = {
  onSetup: () => void;
};

export function Setup({ onSetup }: Props) {
  return (
    <AuthForm
      title="Configurar Acesso"
      subtitle="Defina uma senha para proteger o 3D Manager"
      buttonLabel="Configurar e Entrar"
      buttonLoadingLabel="Configurando..."
      endpoint="/api/auth/setup"
      onSuccess={onSetup}
      requireConfirm
      minLength={4}
    />
  );
}
