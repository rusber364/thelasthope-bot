import { CalendarCog, UsersRound } from 'lucide-react';
import { useState } from 'react';
import type { ArchiveMode, PlayerGroupKind, PlayerGroupSettings, Settings } from '@api';
import { AccessRolesPicker, ChannelPicker, RolePicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, LimitInput, NumberField, SaveBar, SectionCard, TimeInput } from '@/components/settings-ui';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LIMIT_FIELDS } from '@/lib/kinds';
import { useSectionForm } from '@/lib/settings-form';

type RaidsDraft = { raids: Omit<Settings['raids'], 'gatherMinutes' | 'attendanceMinutes' | 'attendanceVoiceChannelId'> };

const ARCHIVE: Record<ArchiveMode, string> = {
  off: 'Не трогать прошедшие реги',
  move: 'Переносить в канал-архив (итог и финальный состав)',
  delete: 'Удалять и оставлять краткий итог в канале реги',
};

const GROUP_KINDS: { kind: PlayerGroupKind; title: string; description: string }[] = [
  { kind: 'dungeon', title: 'Подземелья', description: 'Пятёрки, которые собирают сами игроки: `/group create`, вид «Подземелье».' },
  { kind: 'pvp', title: 'PvP-группы', description: 'Арена, поля боя — `/group create`, вид «PvP».' },
];

const dot = (form: { dirty: boolean }) => form.dirty && <span className="size-1.5 rounded-full bg-primary" aria-label="есть изменения" />;

/** Настройки групп одного вида: канал, места, лимиты, кто может открывать. */
function GroupCard({
  kind,
  title,
  description,
  value,
  set,
}: {
  kind: PlayerGroupKind;
  title: string;
  description: string;
  value: PlayerGroupSettings;
  set: (change: Partial<PlayerGroupSettings>) => void;
}) {
  const id = (name: string) => `${kind}-${name}`;
  return (
    <SectionCard title={title} description={description}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('channel')}>Канал групп</FieldLabel>
          <ChannelPicker id={id('channel')} emptyLabel="Выключено" value={value.channelId} onChange={(channelId) => set({ channelId })} />
          <FieldDescription>Без канала игроки такие группы не открывают.</FieldDescription>
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('roles')}>Кто может открывать</FieldLabel>
          <AccessRolesPicker
            id={id('roles')}
            max={10}
            placeholder="Все участники"
            value={value.creatorRoleIds}
            onChange={(creatorRoleIds) => set({ creatorRoleIds })}
          />
          <FieldDescription>Например, «Рейдер». Менять и отменять свою группу может тот, кто её открыл, и офицеры.</FieldDescription>
        </Field>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Field className="w-auto gap-1.5">
          <FieldLabel htmlFor={id('size')}>Мест</FieldLabel>
          <NumberField id={id('size')} min={1} max={40} value={value.size} onChange={(size) => set({ size })} />
        </Field>
        {LIMIT_FIELDS.map(({ group, title: label }) => (
          <Field key={group} className="w-auto gap-1.5">
            <FieldLabel htmlFor={id(group)} title="Сколько мест в основе для этой роли; пусто — без лимита. Лишние — в запас">
              {label}
            </FieldLabel>
            <LimitInput id={id(group)} value={value.limits[group]} onChange={(n) => set({ limits: { ...value.limits, [group]: n } })} />
          </Field>
        ))}
      </div>
    </SectionCard>
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
    },
  }));
  const groups = useSectionForm('groups', (s) => ({ groups: s.groups }));
  const [tab, setTab] = useState('regs');
  const active = tab === 'groups' ? groups : form;
  const { draft, update } = form;
  const set = (change: Partial<RaidsDraft['raids']>) => update((d) => ({ raids: { ...d.raids, ...change } }));

  return (
    <>
      <PageHeader
        title="Настройки рег"
        description="Что общее для всех рег: размер по умолчанию, временная роль, список ближайших сборов, события Discord и архив; группы, которые открывают сами игроки. Расписание — у шаблонов на странице «Сборы»."
      />
      {!draft || !groups.draft ? (
        <FormSkeleton cards={4} />
      ) : (
        <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="gap-6">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="regs">
              <CalendarCog /> Реги {dot(form)}
            </TabsTrigger>
            <TabsTrigger value="groups">
              <UsersRound /> Группы от игроков {dot(groups)}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="regs" className="flex flex-col gap-6">
            <FormErrors errors={form.errors} />
            <SectionCard title="Новые реги" description="Значения по умолчанию для /raid quick и мастера в личке.">
              <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="size">Мест в основном составе</FieldLabel>
                  <NumberField
                    id="size"
                    min={1}
                    max={100}
                    value={draft.raids.defaultSize}
                    onChange={(defaultSize) => set({ defaultSize })}
                  />
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
              <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
          </TabsContent>
          <TabsContent value="groups" className="flex flex-col gap-6">
            <FormErrors errors={groups.errors} />
            {GROUP_KINDS.map(({ kind, title, description }) => (
              <GroupCard
                key={kind}
                kind={kind}
                title={title}
                description={description}
                value={groups.draft!.groups[kind]}
                set={(change) => groups.update((d) => ({ groups: { ...d.groups, [kind]: { ...d.groups[kind], ...change } } }))}
              />
            ))}
          </TabsContent>
        </Tabs>
      )}
      <SaveBar form={active} />
    </>
  );
}
