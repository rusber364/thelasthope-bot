import { Outlet, useLocation } from 'react-router';
import type { MeResponse } from '@api';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { findNavItem } from '@/nav';

/** Каркас: боковое меню, шапка с названием раздела и переключателем темы, содержимое страницы. */
export function Layout({ me }: { me: MeResponse }) {
  const section = findNavItem(useLocation().pathname);
  return (
    <SidebarProvider>
      <AppSidebar me={me} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:rounded-t-xl">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          {section && (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <section.icon className="size-4 text-primary" />
              <span className="truncate">{section.title}</span>
            </div>
          )}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
