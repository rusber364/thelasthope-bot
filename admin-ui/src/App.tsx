import { RotateCw } from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import { Route, Routes } from 'react-router';
import { AuthScreen } from '@/components/auth-screen';
import { Layout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ApiFailure, errorText } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { DeniedPage } from '@/pages/denied';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';

/** Страница грузится отдельным куском, когда её впервые открывают. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const HomePage = page(() => import('@/pages/home'), 'HomePage');

/** Разделы меню: адрес → страница (внутри раздела могут быть свои адреса, как у опросов). */
const PAGES: Record<string, ComponentType> = {
  '/channels': page(() => import('@/pages/channels'), 'ChannelsPage'),
  '/welcome': page(() => import('@/pages/welcome'), 'WelcomePage'),
  '/logs': page(() => import('@/pages/logs'), 'LogsPage'),
  '/alerts': page(() => import('@/pages/alerts'), 'AlertsPage'),
  '/raids': page(() => import('@/pages/raids'), 'RaidsPage'),
  '/templates': page(() => import('@/pages/templates'), 'TemplatesPage'),
  '/attendance': page(() => import('@/pages/attendance'), 'AttendancePage'),
  '/polls': page(() => import('@/pages/polls'), 'PollsSection'),
  '/sticky': page(() => import('@/pages/sticky'), 'StickyPage'),
  '/autoclean': page(() => import('@/pages/autoclean'), 'AutoCleanPage'),
};

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
        {Object.entries(PAGES).map(([path, Page]) => (
          <Route key={path} path={`${path.slice(1)}/*`} element={<Page />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
