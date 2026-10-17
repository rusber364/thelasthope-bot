import { LogOut } from 'lucide-react';
import { AuthScreen } from '@/components/auth-screen';
import { Button } from '@/components/ui/button';

export function DeniedPage({ message }: { message: string }) {
  return (
    <AuthScreen title="Нет доступа" description={message}>
      <Button render={<a href="/logout" />} nativeButton={false} variant="outline" size="lg" className="w-full">
        <LogOut /> Войти другим аккаунтом
      </Button>
    </AuthScreen>
  );
}
