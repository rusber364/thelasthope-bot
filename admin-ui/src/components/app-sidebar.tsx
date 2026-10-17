import { ChevronsUpDown, LogOut } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import type { MeResponse } from '@api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { HOME, NAV, type NavItem } from '@/nav';

function NavLinkItem({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const active = item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link to={item.to} onClick={() => setOpenMobile(false)} />} isActive={active} tooltip={item.title}>
        <item.icon />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const initials = (name: string) => name.slice(0, 2).toUpperCase();

export function AppSidebar({ me }: { me: MeResponse }) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <img src={me.guild.iconUrl ?? '/logo.jpg'} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold text-sidebar-primary">{me.guild.name}</span>
                <span className="truncate text-xs text-muted-foreground">Админка бота</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLinkItem item={HOME} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {NAV.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavLinkItem key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
                <Avatar className="size-8 rounded-lg">
                  {me.user.avatar && <AvatarImage src={me.user.avatar} alt="" />}
                  <AvatarFallback className="rounded-lg">{initials(me.user.name)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{me.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">Управляет сервером</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal text-muted-foreground">Вход через Discord</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<a href="/logout" />}>
                  <LogOut /> Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
