import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CircleX, Copy, Info, Power, Search, TriangleAlert } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import type { BotLogEntry, BotLogResponse } from '@api';
import { PageHeader } from '@/components/page';
import { ListEmpty } from '@/components/settings-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/lib/api';
import { formatLogTime, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'warn' | 'error';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Всё' },
  { value: 'warn', label: 'Предупреждения и ошибки' },
  { value: 'error', label: 'Только ошибки' },
];

const LEVEL = {
  start: { icon: Power, className: 'text-primary', label: 'Запуск' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Сообщение' },
  warn: { icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400', label: 'Предупреждение' },
  error: { icon: CircleX, className: 'text-destructive', label: 'Ошибка' },
} as const;

/** Одна строка лога. Ошибки со стеком показываются первой строкой — остальное по клику. */
function Row({ entry }: { entry: BotLogEntry }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, className, label } = LEVEL[entry.level];
  const [first, ...rest] = entry.text.split('\n');
  const time = <span className="shrink-0 text-muted-foreground tabular-nums">{formatLogTime(entry.at)}</span>;

  if (entry.level === 'start') {
    return (
      <div className="flex items-center gap-2 border-y bg-primary/5 px-3 py-1.5 text-xs font-medium">
        <Icon className={cn('size-3.5 shrink-0', className)} aria-label={label} />
        {time}
        <span className="min-w-0 break-words">{entry.text}</span>
      </div>
    );
  }
  return (
    <div className={cn('flex items-start gap-2 px-3 py-1 font-mono text-xs', entry.level === 'error' && 'bg-destructive/5')}>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} aria-label={label} />
      {time}
      <div className="min-w-0 flex-1">
        <div className="break-words whitespace-pre-wrap">{first}</div>
        {rest.length > 0 && (
          <>
            <button
              type="button"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {open ? 'Свернуть' : `Подробнее (${rest.length} ${plural(rest.length, ['строка', 'строки', 'строк'])})`}
            </button>
            {open && <div className="break-words whitespace-pre-wrap text-muted-foreground">{rest.join('\n')}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function BotLogPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const query = useDeferredValue(search.trim());

  const log = useInfiniteQuery({
    queryKey: ['botlog', filter, query],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ level: filter, q: query });
      if (pageParam) params.set('before', String(pageParam));
      return api.get<BotLogResponse>(`/botlog?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.entries.at(-1)?.id : undefined),
    refetchInterval: live ? 5000 : false,
  });
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  const copy = async () => {
    const text = entries.map((e) => `${formatLogTime(e.at)} ${LEVEL[e.level].label.toUpperCase()} ${e.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Скопировано строк: ${entries.length}`);
    } catch {
      toast.error('Браузер не дал скопировать — выдели текст вручную.');
    }
  };

  return (
    <>
      <PageHeader
        title="Лог бота"
        description="Что бот писал в консоль: запуски, открытые реги, обрывы связи с Discord, предупреждения и ошибки. Новые строки — сверху, время — по Киеву. Хранятся последние 5000 строк."
      />

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            variant="outline"
            spacing={1}
            value={[filter]}
            onValueChange={(value: string[]) => value[0] && setFilter(value[0] as Filter)}
            className="flex-wrap"
          >
            {FILTERS.map(({ value, label }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="data-pressed:border-primary data-pressed:bg-primary/15 data-pressed:text-primary"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Найти в логе"
              aria-label="Найти в логе"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="live" checked={live} onCheckedChange={(value: boolean) => setLive(value)} />
            <Label htmlFor="live">Обновлять сами</Label>
          </div>
          <Button variant="outline" size="sm" className="sm:ml-auto" disabled={!entries.length} onClick={copy}>
            <Copy /> Скопировать
          </Button>
        </CardContent>
      </Card>

      {log.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : entries.length === 0 ? (
        <ListEmpty>
          {query || filter !== 'all' ? 'Ничего не найдено.' : 'Лог пока пуст — строки появятся, когда бот что-нибудь напишет.'}
        </ListEmpty>
      ) : (
        <Card size="sm" className="gap-0 overflow-hidden py-0">
          <div className="divide-y divide-border/50">
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </div>
          {log.hasNextPage && (
            <div className="border-t p-2 text-center">
              <Button variant="ghost" size="sm" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                {log.isFetchingNextPage && <Spinner />} Показать ещё
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
