import { RotateCw } from 'lucide-react';
import { Route, Routes } from 'react-router';
import { AuthScreen } from '@/components/auth-screen';
import { Layout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ApiFailure, errorText } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { NAV } from '@/nav';
import { DeniedPage } from '@/pages/denied';
import { HomePage } from '@/pages/home';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';
import { PlaceholderPage } from '@/pages/placeholder';

/** Сначала узнаём, кто вошёл: нет сессии — экран входа, нет права «Управлять сервером» — экран «Нет доступа». */
export function App() {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }
  if (me.isError) {
    const status = me.error instanceof ApiFailure ? me.error.status : 0;
    if (status === 401) return <LoginPage />;
    if (status === 403) return <DeniedPage message={errorText(me.error)} />;
    return (
      <AuthScreen title="Админка недоступна" description={errorText(me.error)}>
        <Button size="lg" className="w-full" onClick={() => void me.refetch()}>
          <RotateCw /> Попробовать снова
        </Button>
      </AuthScreen>
    );
  }

  return (
    <Routes>
      <Route element={<Layout me={me.data} />}>
        <Route index element={<HomePage />} />
        {NAV.flatMap((group) => group.items).map((item) => (
          <Route key={item.to} path={`${item.to.slice(1)}/*`} element={<PlaceholderPage item={item} />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
