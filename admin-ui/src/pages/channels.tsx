import { Plus, Trash2 } from 'lucide-react';
import { ChannelPicker, RolePicker, VoicePicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, ListEmpty, SaveBar, SectionCard } from '@/components/settings-ui';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { patch, useSectionForm } from '@/lib/settings-form';

export function ChannelsPage() {
  const form = useSectionForm('channels', (s) => ({ channels: s.channels, roles: s.roles, voiceRoles: s.voiceRoles }));
  const { draft, update } = form;

  return (
    <>
      <PageHeader title="Каналы и роли" description="Где бот приветствует новичков и какие роли выдаёт." />
      {!draft ? (
        <FormSkeleton />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Новички" description="Куда бот пишет, когда кто-то заходит на сервер, и какие роли выдаёт.">
            <FieldGroup className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="welcome">Канал приветствия</FieldLabel>
                <ChannelPicker id="welcome" value={draft.channels.welcome} onChange={(welcome) => update(patch('channels', { welcome }))} />
                <FieldDescription>Сюда бот пишет, когда кто-то заходит на сервер.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="rules">Канал правил</FieldLabel>
                <ChannelPicker id="rules" value={draft.channels.rules} onChange={(rules) => update(patch('channels', { rules }))} />
                <FieldDescription>Ссылка и кнопка «Правила» в приветствии.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="guest">Роль «Гость»</FieldLabel>
                <RolePicker id="guest" value={draft.roles.guest} onChange={(guest) => update(patch('roles', { guest }))} />
                <FieldDescription>Выдаётся по кнопке в приветствии.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="autorole">Автороль</FieldLabel>
                <RolePicker id="autorole" value={draft.roles.autorole} onChange={(autorole) => update(patch('roles', { autorole }))} />
                <FieldDescription>Выдаётся каждому новичку сразу.</FieldDescription>
              </Field>
            </FieldGroup>
          </SectionCard>

          <SectionCard
            title="Голосовые роли"
            description="Пока участник сидит в голосовом канале, у него есть роль; вышел — роль снимается. Удобно, чтобы открыть текстовый канал рейда только тем, кто в голосовом."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => update((d) => ({ ...d, voiceRoles: [...d.voiceRoles, { channelId: '', roleId: '' }] }))}
              >
                <Plus /> Добавить
              </Button>
            }
          >
            {draft.voiceRoles.length === 0 ? (
              <ListEmpty>Связок пока нет. Нажми «Добавить», чтобы выдавать роль в голосовом канале.</ListEmpty>
            ) : (
              <div className="flex flex-col gap-3">
                {draft.voiceRoles.map((link, i) => {
                  const set = (change: Partial<typeof link>) =>
                    update((d) => ({ ...d, voiceRoles: d.voiceRoles.map((l, j) => (j === i ? { ...l, ...change } : l)) }));
                  return (
                    <div key={i} className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]">
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">Голосовой канал</FieldLabel>
                        <VoicePicker required value={link.channelId || null} onChange={(id) => set({ channelId: id ?? '' })} />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">Роль</FieldLabel>
                        <RolePicker required value={link.roleId || null} onChange={(id) => set({ roleId: id ?? '' })} />
                      </Field>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive sm:mt-6"
                        aria-label="Удалить связку"
                        onClick={() => update((d) => ({ ...d, voiceRoles: d.voiceRoles.filter((_, j) => j !== i) }))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
