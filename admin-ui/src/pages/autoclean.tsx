import { Info, Plus, Trash2 } from 'lucide-react';
import { ChannelPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, ListEmpty, NumberField, SaveBar, SectionCard } from '@/components/settings-ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useSectionForm } from '@/lib/settings-form';

const MAX_RULES = 20;

export function AutoCleanPage() {
  const form = useSectionForm('autoclean', (s) => ({ autoClean: s.autoClean }));
  const { draft, update } = form;

  return (
    <>
      <PageHeader
        title="Автоочистка"
        description="Бот раз в 10 минут удаляет в выбранных каналах сообщения старше указанного срока — например, во флуде или ЛФГ."
      />
      {!draft ? (
        <FormSkeleton cards={1} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard
            title="Каналы"
            description="У канала может быть одно правило."
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={draft.autoClean.length >= MAX_RULES}
                onClick={() => update((d) => ({ autoClean: [...d.autoClean, { channelId: '', hours: 24, keepBot: true }] }))}
              >
                <Plus /> Добавить
              </Button>
            }
          >
            {draft.autoClean.length === 0 ? (
              <ListEmpty>Автоочистка не настроена ни для одного канала.</ListEmpty>
            ) : (
              draft.autoClean.map((rule, i) => {
                const set = (change: Partial<typeof rule>) =>
                  update((d) => ({ autoClean: d.autoClean.map((r, j) => (j === i ? { ...r, ...change } : r)) }));
                return (
                  <div key={i} className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground">Канал</FieldLabel>
                      <ChannelPicker required value={rule.channelId || null} onChange={(id) => set({ channelId: id ?? '' })} />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground">Удалять старше</FieldLabel>
                      <NumberField min={1} max={720} suffix="ч" value={rule.hours} onChange={(hours) => set({ hours })} />
                    </Field>
                    <label className="flex h-8 items-center gap-2 text-sm">
                      <Switch checked={rule.keepBot} onCheckedChange={(keepBot: boolean) => set({ keepBot })} />
                      Не трогать сообщения бота
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Убрать правило"
                      onClick={() => update((d) => ({ autoClean: d.autoClean.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })
            )}
          </SectionCard>
          <Alert>
            <Info />
            <AlertDescription>
              Закреплённые сообщения бот не трогает никогда; «не трогать сообщения бота» бережёт реги, опросы и липкие сообщения. Сообщения
              старше 14 дней Discord не даёт удалять пачкой — их бот убирает по одному, понемногу за проход. Вместо записи на каждое
              сообщение в «лог-сообщения» приходит одна сводка.
            </AlertDescription>
          </Alert>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
