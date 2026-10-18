import { useMutation } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, CopyPlus, Plus, Swords, Trash2, Users, NotebookPen } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ActivityKind, Option, RaidSlot, RaidTemplate, TemplateCreateResponse } from '@api';
import { AccessRolesPicker, ChannelPicker, MentionRolesPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, LimitInput, ListEmpty, NumberField, SaveBar, SectionCard, TimeInput } from '@/components/settings-ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorText } from '@/lib/api';
import { formatDay, todayInKyiv } from '@/lib/format';
import { useOptions, useSettings } from '@/lib/queries';
import { useSectionForm } from '@/lib/settings-form';
import { cn } from '@/lib/utils';
import { KINDS, KIND_ITEMS, LIMIT_FIELDS, NO_LIMITS } from '@/lib/kinds';
import { DAYS, leadText, weekChips } from '@/lib/week';

const MAX_TEMPLATES = 25;
const MAX_SLOTS = 14;
const MAX_ROLES = 10;
const nameOf = (list: Option[] | undefined, id: string | null) => (id ? (list?.find((o) => o.id === id)?.name ?? 'удалён') : null);
const DAY_ITEMS = Object.fromEntries(DAYS.map((day, i) => [String(i + 1), day]));
/** Цвета шаблонов в «Неделе» — по номеру шаблона. */
const COLORS = [
  'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
];
const color = (index: number) => COLORS[index % COLORS.length];

/** Полоска пн…вс: в какие дни открываются реги и идут рейды (по черновику — видно до сохранения). */
function WeekStrip({ templates }: { templates: RaidTemplate[] }) {
  const week = weekChips(templates);
  if (week.every((day) => !day.length)) {
    return <ListEmpty>Расписаний пока нет: выбери у шаблона канал и добавь дни рейдов.</ListEmpty>;
  }
  // Колонки пн…вс — только когда хватает ширины самой карточки; уже — день строкой.
  return (
    <div className="@container">
      <div className="grid gap-2 @2xl:grid-cols-7">
        {week.map((chips, i) => (
          <div key={DAYS[i]} className="flex min-w-0 gap-2 rounded-lg border p-2 @2xl:min-h-28 @2xl:flex-col">
            <div className="w-7 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground @2xl:w-auto @2xl:pt-0">{DAYS[i]}</div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1 @2xl:flex-col @2xl:flex-nowrap">
              {chips.map((chip, j) => (
                <div
                  key={j}
                  title={`${chip.kind === 'open' ? `Открывается рег: ${chip.count}` : 'Рейд'} — ${chip.title}`}
                  className={cn('flex max-w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs', color(chip.template))}
                >
                  {chip.kind === 'open' ? <NotebookPen className="size-3 shrink-0" /> : <Swords className="size-3 shrink-0" />}
                  <span className="font-medium tabular-nums">{chip.time}</span>
                  {chip.count > 1 && <span className="font-medium">×{chip.count}</span>}
                  <span className="truncate">{chip.title}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <NotebookPen className="size-3" /> открывается рега
        </span>
        <span className="flex items-center gap-1">
          <Swords className="size-3" /> рейд
        </span>
      </div>
    </div>
  );
}

/** Карточка «создать регу по шаблону»: дата, время и подтверждение. */
function CreateCard({ template }: { template: RaidTemplate }) {
  const { data: options } = useOptions();
  const today = todayInKyiv();
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(template.time);
  const [confirm, setConfirm] = useState(false);
  const channel = nameOf(options?.textChannels, template.channelId);
  const pings = template.pingRoleIds.map((roleId) => nameOf(options?.mentionRoles, roleId));
  const days = [...template.slots].sort((a, b) => a.raidDay - b.raidDay).map((slot) => DAYS[slot.raidDay - 1]);

  const mutation = useMutation({
    mutationFn: () => api.post<TemplateCreateResponse>(`/templates/${template.id}/create`, { date, time }),
    onSuccess: (result) =>
      toast.success(result.message, { action: { label: 'Открыть', onClick: () => window.open(result.url, '_blank', 'noopener') } }),
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{template.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-1.5">
          {template.kind !== 'raid' && <Badge>{KINDS[template.kind].title}</Badge>}
          <Badge variant="secondary">
            <Users /> {template.size} мест
          </Badge>
          {channel && <Badge variant="outline">{channel}</Badge>}
          {days.length > 0 && (
            <Badge variant="outline">
              <CalendarClock /> {days.join(' · ')}
            </Badge>
          )}
          {pings.map((ping, i) => (
            <Badge key={i} variant="outline">
              @{ping}
            </Badge>
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[1fr_auto] gap-2">
        <Input type="date" aria-label="Дата" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input type="time" aria-label="Время" className="w-28" value={time} onChange={(e) => setTime(e.target.value)} />
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!date || mutation.isPending} onClick={() => setConfirm(true)}>
          {mutation.isPending ? <Spinner /> : <CalendarPlus />} Создать регу
        </Button>
      </CardFooter>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Опубликовать регу?</AlertDialogTitle>
            <AlertDialogDescription>
              «{template.title}» на {date ? formatDay(date) : '—'} в {time} — в {channel ?? 'канал шаблона'}
              {pings.length ? ` с упоминанием ${pings.map((ping) => `@${ping}`).join(', ')}` : ''}. Рега сразу появится в Discord.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                mutation.mutate();
              }}
            >
              Опубликовать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function DaySelect({ value, onChange, label }: { value: number; onChange: (day: number) => void; label: string }) {
  return (
    <Select items={DAY_ITEMS} value={String(value)} onValueChange={(day: string | null) => day && onChange(Number(day))}>
      <SelectTrigger aria-label={label} className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DAYS.map((day, i) => (
          <SelectItem key={day} value={String(i + 1)}>
            {day}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Строка расписания: «Рейд [день] [время] ← рега откроется [день] [время] · за 1 д 20 ч». */
function SlotRow({ slot, set, remove }: { slot: RaidSlot; set: (change: Partial<RaidSlot>) => void; remove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Swords className="size-4 text-muted-foreground" />
        <span className="text-sm">Рейд</span>
        <DaySelect label="День рейда" value={slot.raidDay} onChange={(raidDay) => set({ raidDay })} />
        <TimeInput aria-label="Время рейда" value={slot.raidTime} onChange={(e) => set({ raidTime: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NotebookPen className="size-4 text-muted-foreground" />
        <span className="text-sm">рега откроется</span>
        <DaySelect label="День открытия реги" value={slot.openDay} onChange={(openDay) => set({ openDay })} />
        <TimeInput aria-label="Время открытия реги" value={slot.openTime} onChange={(e) => set({ openTime: e.target.value })} />
      </div>
      <span className="text-xs text-muted-foreground">{leadText(slot)}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto text-muted-foreground hover:text-destructive"
        aria-label="Удалить день"
        onClick={remove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function TemplateEditor({
  template,
  index,
  set,
  remove,
  raidSize,
}: {
  template: RaidTemplate;
  index: number;
  set: (change: Partial<RaidTemplate>) => void;
  remove: () => void;
  /** Размер рейда по умолчанию из «Настроек рег» — подставляется, когда выбирают вид «Рейд». */
  raidSize: number;
}) {
  const id = (name: string) => `t${index}-${name}`;
  const setSlots = (slots: RaidSlot[]) => set({ slots });
  const addSlot = () => {
    const used = new Set(template.slots.map((slot) => slot.raidDay));
    const day = [3, 4, 5, 1, 2, 6, 7].find((d) => !used.has(d)) ?? 1;
    setSlots([...template.slots, { raidDay: day, raidTime: template.time, openDay: day, openTime: '00:00' }]);
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-md border', color(index))}>
          <CopyPlus className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1 truncate font-medium">{template.title || 'Новый шаблон'}</div>
        {!template.id && <Badge variant="secondary">не сохранён</Badge>}
        {!template.channelId && template.slots.length > 0 && <Badge variant="secondary">без канала — реги не откроются</Badge>}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label="Удалить шаблон"
          onClick={remove}
        >
          <Trash2 />
        </Button>
      </div>

      {/* Основное — вид, название, канал; ниже — места и состав по ролям. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('kind')} title="Подставляет размер и лимиты по ролям — их можно поменять">
            Вид
          </FieldLabel>
          <Select
            items={KIND_ITEMS}
            value={template.kind}
            onValueChange={(kind: ActivityKind | null) =>
              kind && set({ kind, size: kind === 'raid' ? raidSize : KINDS[kind].size, limits: KINDS[kind].limits })
            }
          >
            <SelectTrigger id={id('kind')} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_ITEMS) as ActivityKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {KIND_ITEMS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('title')}>Название</FieldLabel>
          <Input id={id('title')} maxLength={100} value={template.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field className="gap-1.5 sm:col-span-2 lg:col-span-1">
          <FieldLabel htmlFor={id('channel')}>Канал рег</FieldLabel>
          <ChannelPicker
            id={id('channel')}
            emptyLabel="Не выбран"
            value={template.channelId}
            onChange={(channelId) => set({ channelId })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Field className="w-auto gap-1.5">
          <FieldLabel htmlFor={id('size')}>Мест</FieldLabel>
          <NumberField id={id('size')} min={1} max={100} value={template.size} onChange={(size) => set({ size })} />
        </Field>
        {LIMIT_FIELDS.map(({ group, title }) => (
          <Field key={group} className="w-auto gap-1.5">
            <FieldLabel htmlFor={id(group)} title="Сколько мест в основе для этой роли; пусто — без лимита. Лишние — в запас">
              {title}
            </FieldLabel>
            <LimitInput
              id={id(group)}
              value={template.limits[group]}
              onChange={(n) => set({ limits: { ...template.limits, [group]: n } })}
            />
          </Field>
        ))}
        <Field className="w-auto gap-1.5">
          <FieldLabel htmlFor={id('time')} title="Подставляется в «Создать регу сейчас»">
            Время вручную
          </FieldLabel>
          <TimeInput id={id('time')} value={template.time} onChange={(e) => set({ time: e.target.value })} />
        </Field>
      </div>

      <Field className="gap-1.5">
        <FieldLabel htmlFor={id('description')}>Описание</FieldLabel>
        <Textarea
          id={id('description')}
          rows={1}
          maxLength={1000}
          className="min-h-9"
          placeholder="Сбор, требования — необязательно"
          value={template.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>

      {/* Роли — три поля в ряд. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('ping')}>Упомянуть при открытии</FieldLabel>
          <MentionRolesPicker
            id={id('ping')}
            max={MAX_ROLES}
            value={template.pingRoleIds}
            onChange={(pingRoleIds) => set({ pingRoleIds })}
          />
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('main')} title="Без нужной роли бот скрыто ответит, для кого рега">
            Записываются в основу
          </FieldLabel>
          <AccessRolesPicker
            id={id('main')}
            max={MAX_ROLES}
            placeholder="Все участники"
            value={template.mainRoleIds}
            onChange={(mainRoleIds) => set({ mainRoleIds, ...(mainRoleIds.length ? {} : { reserveRoleIds: [] }) })}
          />
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('reserve')} title="Записываются, но сразу в запас, даже если в основе есть места">
            Только в запас
          </FieldLabel>
          <AccessRolesPicker
            id={id('reserve')}
            max={MAX_ROLES}
            disabled={!template.mainRoleIds.length}
            placeholder={template.mainRoleIds.length ? 'Например, Гость' : 'Сначала выбери основу'}
            value={template.reserveRoleIds}
            onChange={(reserveRoleIds) => set({ reserveRoleIds })}
          />
        </Field>
      </div>

      <Field className="gap-1.5">
        <FieldLabel>Расписание</FieldLabel>
        {template.slots.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {template.slots.map((slot, i) => (
              <SlotRow
                key={i}
                slot={slot}
                set={(change) => setSlots(template.slots.map((s, j) => (j === i ? { ...s, ...change } : s)))}
                remove={() => setSlots(template.slots.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="outline" size="sm" disabled={template.slots.length >= MAX_SLOTS} onClick={addSlot}>
            <Plus /> Добавить день
          </Button>
          <FieldDescription>
            {template.slots.length
              ? 'По Киеву · рега открывается не раньше чем за неделю до рейда'
              : 'Без расписания — рега только кнопкой «Создать регу»'}
          </FieldDescription>
        </div>
      </Field>
    </div>
  );
}

export function TemplatesPage() {
  const { data: settings } = useSettings();
  const form = useSectionForm('templates', (s) => ({ raidTemplates: s.raidTemplates }));
  const { draft, update } = form;
  const saved = settings?.raidTemplates ?? [];
  const setList = (raidTemplates: RaidTemplate[]) => update(() => ({ raidTemplates }));

  return (
    <>
      <PageHeader
        title="Сборы"
        description="Шаблоны рейдов, подземелий и PvP: по расписанию бот сам открывает реги и упоминает роли, а кнопкой — создаёт регу на любую дату. Группы, которые открывают сами игроки, — в «Настройках рег»."
      />
      {!draft || !settings ? (
        <FormSkeleton />
      ) : (
        <>
          <SectionCard title="Неделя" description="Когда открываются реги и когда идут рейды — с учётом несохранённых изменений.">
            <WeekStrip templates={draft.raidTemplates} />
          </SectionCard>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Создать регу сейчас</h2>
            {saved.length === 0 ? (
              <ListEmpty>Шаблонов пока нет — добавь первый ниже.</ListEmpty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {saved.map((template) => (
                  <CreateCard key={template.id} template={template} />
                ))}
              </div>
            )}
          </section>

          <FormErrors errors={form.errors} />
          <SectionCard
            title="Шаблоны"
            description={`До ${MAX_TEMPLATES} шаблонов. Рега создаётся по сохранённому варианту; уже открытые реги правка шаблона не меняет.`}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={draft.raidTemplates.length >= MAX_TEMPLATES}
                onClick={() =>
                  setList([
                    ...draft.raidTemplates,
                    {
                      id: '',
                      title: '',
                      description: '',
                      size: settings.raids.defaultSize,
                      time: settings.raids.defaultTime,
                      channelId: null,
                      pingRoleIds: [],
                      mainRoleIds: [],
                      reserveRoleIds: [],
                      kind: 'raid',
                      limits: NO_LIMITS,
                      slots: [],
                    },
                  ])
                }
              >
                <Plus /> Добавить
              </Button>
            }
          >
            {draft.raidTemplates.length === 0 ? (
              <ListEmpty>Нажми «Добавить», чтобы сделать первый шаблон.</ListEmpty>
            ) : (
              draft.raidTemplates.map((template, i) => (
                <TemplateEditor
                  key={template.id || `new-${i}`}
                  index={i}
                  template={template}
                  set={(change) => setList(draft.raidTemplates.map((t, j) => (j === i ? { ...t, ...change } : t)))}
                  remove={() => setList(draft.raidTemplates.filter((_, j) => j !== i))}
                  raidSize={settings.raids.defaultSize}
                />
              ))
            )}
          </SectionCard>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
