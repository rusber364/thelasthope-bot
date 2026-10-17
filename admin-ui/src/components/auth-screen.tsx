import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Экран до входа в админку: логотип гильдии по центру и карточка с действием. */
export function AuthScreen({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_60%)]" />
      <Card className="relative w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/logo.jpg" alt="" className="mx-auto mb-2 size-20 rounded-2xl object-cover shadow-lg ring-1 ring-primary/40" />
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </div>
  );
}
