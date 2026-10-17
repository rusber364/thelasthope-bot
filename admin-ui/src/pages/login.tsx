import { LogIn } from 'lucide-react';
import { AuthScreen } from '@/components/auth-screen';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function LoginPage() {
  const failed = new URLSearchParams(location.search).has('login-failed');
  return (
    <AuthScreen
      title="The Last Hope"
      description="Админка бота гильдии. Войди через Discord — доступ есть у тех, кто может управлять сервером."
    >
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>Не получилось войти. Попробуй ещё раз.</AlertDescription>
        </Alert>
      )}
      <Button render={<a href="/login" />} nativeButton={false} size="lg" className="w-full">
        <LogIn /> Войти через Discord
      </Button>
    </AuthScreen>
  );
}
