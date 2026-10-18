import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import type { ArchiveMode, RaidSchedule, Settings } from '@api';
import { ChannelPicker, MentionPicker, RolePicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, ListEmpty, NumberField, SaveBar, SectionCard, TimeInput } from '@/components/settings-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSectionForm } from '@/lib/settings-form';

type RaidsDraft = { raids: Omit<Settings['raids'], 'gatherMinutes' | 'attendanceMinutes' | 'attendanceVoiceChannelId'> };

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const ARCHIVE: Record<ArchiveMode, string> = {
  off: 'Не трогать прошедшие реги',
  move: 'Переносить в канал-архив (итог и финальный состав)',
  delete: 'Удалять и оставлять краткий итог в канале реги',
};

/** «Пн, Ср в 12:00 → рейд через 1 дн. в 20:00» — коротко, что делает расписание. */
function describe(s: RaidSchedule): string {
  if (!s.days.length) return 'дни не выбраны';
  const days = s.days.map((d) => DAYS[d - 1]).join(', ');
  const when = s.raidDayOffset === 0 ? 'в тот же день' : `через ${s.raidDayOffset} дн.`;
  return `открывается ${days} в ${s.openAt} · рейд ${when} в ${s.raidTime}`;
}

function ScheduleCard({
  schedule,
  index,
  set,
  remove,
}: {
  schedule: RaidSchedule;
  index: number;
  set: (change: Partial<RaidSchedule>) => void;
  remove: () => void;
}) {
  const id = (name: string) => `s${index}-${name}`;
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <CalendarClock className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {schedule.title || 'Без названия'}
            {!schedule.channelId && <Badge variant="secondary">выключено</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">{describe(schedule)}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          aria-label="Удалить расписание"
          onClick={remove}
        >
          <Trash2 />
        </Button>
      </div>
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={id('title')}>Название реги</FieldLabel>
          <Input id={id('title')} maxLength={100} value={schedule.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('channel')}>Канал</FieldLabel>
          <ChannelPicker
            id={id('channel')}
            emptyLabel="Выключено"
            value={schedule.channelId}
            onChange={(channelId) => set({ channelId })}
          />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel>Дни открытия реги</FieldLabel>
          <ToggleGroup
            multiple
            variant="outline"
            spacing={1}
            value={schedule.days.map(String)}
            onValueChange={(days: string[]) => set({ days: days.map(Number).sort((a, b) => a - b) })}
            className="flex-wrap"
          >
            {DAYS.map((day, i) => (
              <ToggleGroupItem
                key={day}
                value={String(i + 1)}
                className="w-11 data-pressed:border-primary data-pressed:bg-primary/15 data-pressed:text-primary"
              >
                {day}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor={id('open')}>Время открытия</FieldLabel>
          <TimeInput id={id('open')} value={schedule.openAt} onChange={(e) => set({ openAt: e.target.value })} />
          <FieldDescription>По Киеву.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={id('raid')}>Время рейда</FieldLabel>
          <TimeInput id={id('raid')} value={schedule.raidTime} onChange={(e) => set({ raidTime: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('offset')}>Рейд через</FieldLabel>
          <NumberField
            id={id('offset')}
            min={0}
            max={14}
            suffix="дн. после открытия"
            value={schedule.raidDayOffset}
            onChange={(raidDayOffset) => set({ raidDayOffset })}
          />
          <FieldDescription>0 — в тот же день.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={id('ping')}>Упомянуть при открытии</FieldLabel>
          <MentionPicker id={id('ping')} emptyLabel="Никого" value={schedule.pingRoleId} onChange={(pingRoleId) => set({ pingRoleId })} />
        </Field>
      </FieldGroup>
    </div>
  );
}

export function RaidsPage() {
  const form = useSectionForm('raids', (s): RaidsDraft => ({
    raids: {
      defaultSize: s.raids.defaultSize,
      defaultTime: s.raids.defaultTime,
      tempRoleId: s.raids.tempRoleId,
      tempRoleHours: s.raids.tempRoleHours,
      archive: s.raids.archive,
      boardChannelId: s.raids.boardChannelId,
      discordEvents: s.raids.discordEvents,
      schedules: s.raids.schedules,
    },
  }));
  const { draft, update } = form;
  const set = (change: Partial<RaidsDraft['raids']>) => update((d) => ({ raids: { ...d.raids, ...change } }));

  return (
    <>
      <PageHeader
        title="Расписание рег"
        description="Бот сам открывает реги в выбранные дни и время, ведёт список ближайших рейдов и убирает прошедшие."
      />
      {!draft ? (
        <FormSkeleton cards={4} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Новые реги" description="Значения по умолчанию для /raid quick и мастера в личке.">
            <FieldGroup className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="size">Мест в основном составе</FieldLabel>
                <NumberField id="size" min={1} max={100} value={draft.raids.defaultSize} onChange={(defaultSize) => set({ defaultSize })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="time">Время рейда</FieldLabel>
                <TimeInput id="time" value={draft.raids.defaultTime} onChange={(e) => set({ defaultTime: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="temp-role">Временная роль участникам</FieldLabel>
                <RolePicker
                  id="temp-role"
                  emptyLabel="Не выдавать"
                  value={draft.raids.tempRoleId}
                  onChange={(tempRoleId) => set({ tempRoleId })}
                />
                <FieldDescription>Выдаётся при записи на регу.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="temp-hours">Снимать роль через</FieldLabel>
                <NumberField
                  id="temp-hours"
                  min={1}
                  max={48}
                  suffix="ч после начала"
                  value={draft.raids.tempRoleHours}
                  onChange={(tempRoleHours) => set({ tempRoleHours })}
                />
              </Field>
            </FieldGroup>
          </SectionCard>

          <SectionCard title="Список рейдов и события">
            <Field>
              <FieldLabel htmlFor="board">Живой список ближайших рейдов</FieldLabel>
              <ChannelPicker
                id="board"
                emptyLabel="Не показывать"
                value={draft.raids.boardChannelId}
                onChange={(boardChannelId) => set({ boardChannelId })}
              />
              <FieldDescription>Одно сообщение со всеми открытыми регами — бот обновляет его сам.</FieldDescription>
            </Field>
            <Field orientation="horizontal" className="items-start">
              <Switch
                id="events"
                checked={draft.raids.discordEvents}
                onCheckedChange={(discordEvents: boolean) => set({ discordEvents })}
              />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="events">Создавать событие Discord для каждой реги</FieldLabel>
                <FieldDescription>Вкладка «События» сервера; боту нужно право «Создавать события».</FieldDescription>
              </div>
            </Field>
          </SectionCard>

          <SectionCard title="Архив прошедших рег">
            <FieldGroup className="grid gap-5 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel>Что делать с регой после рейда</FieldLabel>
                <Select
                  items={ARCHIVE}
                  value={draft.raids.archive.mode}
                  onValueChange={(mode: ArchiveMode | null) => mode && set({ archive: { ...draft.raids.archive, mode } })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ARCHIVE) as ArchiveMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {ARCHIVE[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {draft.raids.archive.mode === 'move' && (
                <Field>
                  <FieldLabel htmlFor="archive-channel">Канал-архив</FieldLabel>
                  <ChannelPicker
                    id="archive-channel"
                    required
                    value={draft.raids.archive.channelId}
                    onChange={(channelId) => set({ archive: { ...draft.raids.archive, channelId } })}
                  />
                </Field>
              )}
              {draft.raids.archive.mode !== 'off' && (
                <Field>
                  <FieldLabel htmlFor="archive-hours">Через</FieldLabel>
                  <NumberField
                    id="archive-hours"
                    min={1}
                    max={72}
                    suffix="ч после начала"
                    value={draft.raids.archive.hours}
                    onChange={(hours) => set({ archive: { ...draft.raids.archive, hours } })}
                  />
                </Field>
              )}
            </FieldGroup>
          </SectionCard>

          <SectionCard
            title="Расписания"
            description="Без канала расписание не работает. Время — по Киеву."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  set({
                    schedules: [
                      ...draft.raids.schedules,
                      {
                        id: '',
                        title: '',
                        channelId: null,
                        days: [],
                        openAt: '12:00',
                        raidDayOffset: 0,
                        raidTime: draft.raids.defaultTime,
                        pingRoleId: null,
                      },
                    ],
                  })
                }
              >
                <Plus /> Добавить
              </Button>
            }
          >
            {draft.raids.schedules.length === 0 ? (
              <ListEmpty>Расписаний пока нет — реги открываются только вручную.</ListEmpty>
            ) : (
              draft.raids.schedules.map((schedule, i) => (
                <ScheduleCard
                  key={schedule.id || `new-${i}`}
                  index={i}
                  schedule={schedule}
                  set={(change) => set({ schedules: draft.raids.schedules.map((s, j) => (j === i ? { ...s, ...change } : s)) })}
                  remove={() => set({ schedules: draft.raids.schedules.filter((_, j) => j !== i) })}
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
