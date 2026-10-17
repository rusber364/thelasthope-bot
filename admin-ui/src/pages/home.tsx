import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight, ClipboardList, ImageUp, Swords, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/api';
import { useOverview } from '@/lib/queries';
import { NAV } from '@/nav';

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number | undefined }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4 text-primary" /> {label}
        </CardDescription>
        <div className="font-heading text-3xl font-semibold tabular-nums">{value ?? <Skeleton className="h-9 w-16" />}</div>
      </CardHeader>
    </Card>
  );
}

function BrandingButton({ part, label }: { part: 'avatar' | 'banner'; label: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.post(`/branding/${part}`),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (error) => toast.error(errorText(error)),
  });
  return (
    <Button variant={part === 'avatar' ? 'default' : 'outline'} disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending ? <Spinner /> : <ImageUp />} {label}
    </Button>
  );
}

export function HomePage() {
  const { data } = useOverview();
  const ping = data && (data.ping >= 0 ? `${data.ping} мс` : '—');

  return (
    <>
      <PageHeader
        title={data ? `Бот ${data.bot}` : 'Главная'}
        description={data && `Сервер «${data.guild}». Изменения в настройках действуют сразу — перезапуск не нужен.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Users} label="Участников" value={data?.members} />
        <Stat icon={Swords} label="Открытых рег" value={data?.openRaids} />
        <Stat icon={ClipboardList} label="Опросов" value={data?.polls} />
        <Stat icon={Activity} label="Задержка Discord" value={ping} />
      </div>

      <Card className="pt-0">
        <div className="relative h-32 bg-muted sm:h-40">
          {data?.bannerUrl ? (
            <img src={data.bannerUrl} alt="Баннер бота" className="size-full object-cover" />
          ) : (
            <div className="size-full bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_35%,transparent),transparent)]" />
          )}
          <Avatar className="absolute -bottom-8 left-4 size-16 ring-4 ring-card">
            {data && <AvatarImage src={data.avatarUrl} alt="Аватар бота" />}
            <AvatarFallback>TLH</AvatarFallback>
          </Avatar>
        </div>
        <CardHeader className="pt-8">
          <CardTitle className="flex items-center gap-2">
            Оформление бота <Badge variant="secondary">{data?.bot ?? '…'}</Badge>
          </CardTitle>
          <CardDescription>
            Аватар берётся из <code>assets/bot-avatar.png</code> или <code>logo.jpg</code>, баннер — из <code>assets/bot-banner.png</code>{' '}
            (лучше широкий, 680×240) или <code>logo.jpg</code>. Discord разрешает менять их не слишком часто.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap gap-2 border-t pt-4">
          <BrandingButton part="avatar" label="Обновить аватар" />
          <BrandingButton part="banner" label="Обновить баннер" />
        </CardFooter>
      </Card>

      {NAV.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{group.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <Link key={item.to} to={item.to} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Card size="sm" className="h-full transition-colors group-hover:bg-accent/60">
                  <CardContent className="flex gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <item.icon className="size-4.5" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1 font-medium">
                        {item.title}
                        <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
