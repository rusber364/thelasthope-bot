import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarCheck, Percent, Search, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ActivityKind, AttendanceResponse, AttendanceRow } from '@api';
import { PageHeader } from '@/components/page';
import { ListEmpty } from '@/components/settings-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { shiftDate, todayInKyiv } from '@/lib/format';
import { cn } from '@/lib/utils';

type SortKey = 'name' | 'rate' | 'present' | 'absent' | 'tentativePresent' | 'tentativeAbsent' | 'walkin';

const COLUMNS: { key: Exclude<SortKey, 'name' | 'rate'>; icon: string; label: string }[] = [
  { key: 'present', icon: '✅', label: 'На рейде' },
  { key: 'absent', icon: '❌', label: 'Пропуск' },
  { key: 'tentativePresent', icon: '☑️', label: '«Под вопросом», но на рейде' },
  { key: 'tentativeAbsent', icon: '❔', label: '«Под вопросом», не было — предупреждение заранее, не пропуск' },
  { key: 'walkin', icon: '➕', label: 'Без записи, но на рейде' },
];

const PRESETS = [7, 30, 90];

type KindFilter = 'all' | ActivityKind;
const KIND_FILTER: Record<KindFilter, string> = { all: 'Все сборы', raid: 'Рейды', dungeon: 'Подземелья', pvp: 'PvP' };

function rateColor(rate: number) {
  if (rate >= 80) return 'bg-success';
  if (rate >= 50) return 'bg-amber-500';
  return 'bg-destructive';
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-primary">
          {icon} {label}
        </CardDescription>
        <div className="font-heading text-3xl font-semibold tabular-nums">{value}</div>
      </CardHeader>
    </Card>
  );
}

function compare(a: AttendanceRow, b: AttendanceRow, key: SortKey): number {
  if (key === 'name') return a.name.localeCompare(b.name, 'ru');
  if (key === 'rate') return (a.rate ?? -1) - (b.rate ?? -1);
  return a[key] - b[key];
}

export function AttendancePage() {
  const today = todayInKyiv();
  const [range, setRange] = useState({ from: shiftDate(today, -30), to: today });
  const [form, setForm] = useState(range);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['attendance', range.from, range.to, kind],
    queryFn: () => api.get<AttendanceResponse>(`/attendance?${new URLSearchParams({ ...range, ...(kind === 'all' ? {} : { kind }) })}`),
  });

  const preset = (days: number) => {
    const next = { from: shiftDate(today, -days), to: today };
    setForm(next);
    setRange(next);
  };

  const rows = (data?.rows ?? []).filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()));
  // Без выбранной сортировки — порядок бота: сверху те, кто чаще пропускает.
  if (sort) rows.sort((a, b) => compare(a, b, sort.key) * (sort.desc ? -1 : 1));
  const rated = (data?.rows ?? []).filter((row) => row.rate !== null);
  const average = rated.length ? Math.round(rated.reduce((sum, row) => sum + row.rate!, 0) / rated.length) : null;

  const header = (key: SortKey, children: ReactNode, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((current) => (current?.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'name' }))}
      >
        {children}
        {sort?.key === key && (sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
      </button>
    </TableHead>
  );

  return (
    <>
      <PageHeader
        title="Посещаемость"
        description={
          <>
            По отметкам, которые бот ставит через несколько минут после начала рейда (настройка — в «Оповещениях»). Посещаемость = на рейде
            / (на рейде + пропуски); «под вопросом» без прихода — предупреждение заранее, не пропуск. Для одного игрока в Discord —{' '}
            <code>/history</code>.
          </>
        }
      />

      <Card size="sm">
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setRange(form);
            }}
          >
            <Field className="w-auto">
              <FieldLabel htmlFor="from">С</FieldLabel>
              <Input id="from" type="date" max={form.to} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="to">По</FieldLabel>
              <Input
                id="to"
                type="date"
                min={form.from}
                max={today}
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="kind">Вид</FieldLabel>
              <Select items={KIND_FILTER} value={kind} onValueChange={(value: KindFilter | null) => value && setKind(value)}>
                <SelectTrigger id="kind" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_FILTER) as KindFilter[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {KIND_FILTER[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit">Показать</Button>
            <div className="flex gap-1 sm:ml-auto">
              {PRESETS.map((days) => (
                <Button key={days} type="button" variant="ghost" size="sm" onClick={() => preset(days)}>
                  {days} дней
                </Button>
              ))}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<CalendarCheck />} label="Рейдов с проверкой" value={data ? data.checked : <Skeleton className="h-9 w-12" />} />
        <Stat icon={<Users />} label="Игроков" value={data ? data.rows.length : <Skeleton className="h-9 w-12" />} />
        <Stat
          icon={<Percent />}
          label="Средняя посещаемость"
          value={data ? average === null ? '—' : `${average}%` : <Skeleton className="h-9 w-12" />}
        />
      </div>

      <Card className={cn('transition-opacity', isFetching && 'opacity-60')}>
        <CardContent className="flex flex-col gap-3">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Найти игрока" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <ListEmpty>{data.rows.length ? 'Никого не нашлось.' : 'За этот период отметок нет.'}</ListEmpty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {header('name', 'Игрок')}
                  {header('rate', 'Посещаемость', 'min-w-44')}
                  {COLUMNS.map((column) => (
                    <Tooltip key={column.key}>
                      <TooltipTrigger
                        render={<th className="h-10 px-2 text-center align-middle font-medium whitespace-nowrap text-muted-foreground" />}
                      >
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() =>
                            setSort((current) =>
                              current?.key === column.key ? { key: column.key, desc: !current.desc } : { key: column.key, desc: true },
                            )
                          }
                        >
                          {column.icon}
                          {sort?.key === column.key && (sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{column.label}</TooltipContent>
                    </Tooltip>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.rate === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                            <div className={cn('h-full rounded-full', rateColor(row.rate))} style={{ width: `${row.rate}%` }} />
                          </div>
                          <span className="tabular-nums">{row.rate}%</span>
                        </div>
                      )}
                    </TableCell>
                    {COLUMNS.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn('text-center tabular-nums', !row[column.key] && 'text-muted-foreground/50')}
                      >
                        {row[column.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
