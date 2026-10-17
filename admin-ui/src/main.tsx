import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiFailure } from '@/lib/api';
import { ThemeProvider } from '@/lib/theme';
import './index.css';

/** Сессия истекла или право сняли — перепроверяем /api/me, и App покажет вход или «Нет доступа». */
function onAuthError(error: unknown) {
  if (error instanceof ApiFailure && (error.status === 401 || error.status === 403)) {
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => query.queryKey[0] !== 'me' && onAuthError(error) }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      // Ошибки 4xx (нет входа, нет доступа, неверный запрос) повторять бессмысленно.
      retry: (count, error) => !(error instanceof ApiFailure && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
