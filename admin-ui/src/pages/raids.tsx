import type { ArchiveMode, Settings } from '@api';
import { ChannelPicker, RolePicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, NumberField, SaveBar, SectionCard, TimeInput } from '@/components/settings-ui';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSectionForm } from '@/lib/settings-form';

type RaidsDraft = { raids: Omit<Settings['raids'], 'gatherMinutes' | 'attendanceMinutes' | 'attendanceVoiceChannelId'> };

const ARCHIVE: Record<ArchiveMode, string> = {
  off: 'Не трогать прошедшие реги',
  move: 'Переносить в канал-архив (итог и финальный состав)',
  delete: 'Удалять и оставлять краткий итог в канале реги',
};

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
  const { draft, update } = form;
  const set = (change: Partial<RaidsDraft['raids']>) => update((d) => ({ raids: { ...d.raids, ...change } }));

  return (
    <>
      <PageHeader
        title="Настройки рег"
        description="Что общее для всех рег: размер по умолчанию, временная роль, список ближайших рейдов, события Discord и архив. Расписание — у шаблонов на странице «Рейды»."
      />
      {!draft ? (
        <FormSkeleton cards={4} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Новые реги" description="Значения по умолчанию для /raid quick и мастера в личке.">
            <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
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

          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
