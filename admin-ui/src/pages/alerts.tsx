import { AtSign } from 'lucide-react';
import { ChannelPicker, MentionPicker, VoicePicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, NumberField, SaveBar, SectionCard } from '@/components/settings-ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { patch, useSectionForm } from '@/lib/settings-form';

export function AlertsPage() {
  const form = useSectionForm('alerts', (s) => ({
    alerts: s.alerts,
    raids: {
      gatherMinutes: s.raids.gatherMinutes,
      attendanceMinutes: s.raids.attendanceMinutes,
      attendanceVoiceChannelId: s.raids.attendanceVoiceChannelId,
    },
  }));
  const { draft, update } = form;

  return (
    <>
      <PageHeader
        title="Оповещения"
        description="Что бот сообщает офицерам, модераторам и игрокам вокруг рейдов. 0 в поле минут или часов — выключить."
      />
      {!draft ? (
        <FormSkeleton cards={3} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Офицерам" description="Отчёт о посещаемости и поздние отписки от рег.">
            <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="alerts-channel">Канал оповещений</FieldLabel>
                <ChannelPicker
                  id="alerts-channel"
                  value={draft.alerts.channelId}
                  onChange={(channelId) => update(patch('alerts', { channelId }))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="alerts-role">Кого упоминать</FieldLabel>
                <MentionPicker
                  id="alerts-role"
                  emptyLabel="Никого"
                  value={draft.alerts.roleId}
                  onChange={(roleId) => update(patch('alerts', { roleId }))}
                />
                <FieldDescription>Например, @Офицер.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="late">Поздняя отписка</FieldLabel>
                <NumberField
                  id="late"
                  min={0}
                  max={72}
                  suffix="ч до рейда"
                  value={draft.alerts.lateCancelHours}
                  onChange={(lateCancelHours) => update(patch('alerts', { lateCancelHours }))}
                />
                <FieldDescription>Отписка позже этого срока приходит офицерам.</FieldDescription>
              </Field>
            </FieldGroup>
          </SectionCard>

          <SectionCard
            title="Модераторам"
            description="Карточка с кнопками «Мут 1 ч», «Бан», «Пропустить» на мат, вход совсем нового аккаунта и массовые упоминания."
          >
            <Field>
              <FieldLabel htmlFor="incidents">Канал инцидентов</FieldLabel>
              <ChannelPicker
                id="incidents"
                emptyLabel="Не присылать"
                value={draft.alerts.incidentChannelId}
                onChange={(incidentChannelId) => update(patch('alerts', { incidentChannelId }))}
              />
            </Field>
          </SectionCard>

          <SectionCard title="Рейды" description="«Сбор!» в канале реги и проверка, кто пришёл на рейд.">
            <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="gather">«Сбор!» в канале реги</FieldLabel>
                <NumberField
                  id="gather"
                  min={0}
                  max={120}
                  suffix="мин до начала"
                  value={draft.raids.gatherMinutes}
                  onChange={(gatherMinutes) => update(patch('raids', { gatherMinutes }))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="attendance">Проверка посещаемости</FieldLabel>
                <NumberField
                  id="attendance"
                  min={0}
                  max={180}
                  suffix="мин после начала"
                  value={draft.raids.attendanceMinutes}
                  onChange={(attendanceMinutes) => update(patch('raids', { attendanceMinutes }))}
                />
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="attendance-voice">Голосовой канал рейда</FieldLabel>
                <VoicePicker
                  id="attendance-voice"
                  emptyLabel="Любой голосовой"
                  value={draft.raids.attendanceVoiceChannelId}
                  onChange={(attendanceVoiceChannelId) => update(patch('raids', { attendanceVoiceChannelId }))}
                />
                <FieldDescription>Кого считать пришедшими: тех, кто в этом канале. Без выбора — в любом голосовом.</FieldDescription>
              </Field>
            </FieldGroup>
          </SectionCard>
          <Alert>
            <AtSign />
            <AlertDescription>
              Чтобы упоминание роли офицеров дошло, роль должна быть упоминаемой: настройки роли → «Разрешить всем @упоминать эту роль».
            </AlertDescription>
          </Alert>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
