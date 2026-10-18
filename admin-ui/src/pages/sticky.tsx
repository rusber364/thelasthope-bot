import { AtSign, Pin, Plus, Trash2 } from 'lucide-react';
import { ChannelPicker, MentionRolesPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, ListEmpty, NumberField, SaveBar, SectionCard, TokenTextarea } from '@/components/settings-ui';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { patch, useSectionForm } from '@/lib/settings-form';

const STICKY_TEXT_MAX = 1800;
const STICKY_ROLES_MAX = 5;

export function StickyPage() {
  const form = useSectionForm('sticky', (s) => ({ sticky: s.sticky }));
  const { draft, update } = form;

  return (
    <>
      <PageHeader
        title="Липкие сообщения"
        description="Текст, который всегда остаётся последним в канале: после новых сообщений бот удаляет прошлую копию и публикует его заново внизу. Подходит для правил рег, ЛФГ или важных объявлений."
      />
      {!draft ? (
        <FormSkeleton />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Как часто переставлять">
            <Field>
              <FieldLabel htmlFor="interval">Не чаще раза в</FieldLabel>
              <NumberField
                id="interval"
                min={5}
                max={600}
                suffix="секунд"
                value={draft.sticky.intervalSeconds}
                onChange={(intervalSeconds) => update(patch('sticky', { intervalSeconds }))}
              />
              <FieldDescription>Если в канале активно пишут, бот переставит сообщение вниз не чаще этого срока.</FieldDescription>
            </Field>
          </SectionCard>

          <SectionCard
            title="Сообщения"
            description={
              <>
                В одном канале — одно липкое сообщение. Упомянутые роли (до {STICKY_ROLES_MAX}) стоят в начале сообщения и получают
                уведомление при публикации и после изменения текста или ролей; при обычной перестановке вниз упоминание видно, но без
                повторного уведомления. Роль должна быть упоминаемой, или у бота должно быть право «Упоминать @everyone, @here и все роли».
              </>
            }
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update((d) => ({ sticky: { ...d.sticky, items: [...d.sticky.items, { channelId: '', text: '', roleIds: [] }] } }))
                }
              >
                <Plus /> Добавить
              </Button>
            }
          >
            {draft.sticky.items.length === 0 ? (
              <ListEmpty>Липких сообщений пока нет.</ListEmpty>
            ) : (
              draft.sticky.items.map((item, i) => {
                const set = (change: Partial<typeof item>) =>
                  update((d) => ({ sticky: { ...d.sticky, items: d.sticky.items.map((it, j) => (j === i ? { ...it, ...change } : it)) } }));
                return (
                  <div key={i} className="flex flex-col gap-3 rounded-lg border p-3">
                    <div className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">
                          <Pin className="size-3.5" /> Канал
                        </FieldLabel>
                        <ChannelPicker required value={item.channelId || null} onChange={(id) => set({ channelId: id ?? '' })} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`sticky-roles-${i}`} className="text-xs text-muted-foreground">
                          <AtSign className="size-3.5" /> Упомянуть роли
                        </FieldLabel>
                        <MentionRolesPicker
                          id={`sticky-roles-${i}`}
                          max={STICKY_ROLES_MAX}
                          value={item.roleIds}
                          onChange={(roleIds) => set({ roleIds })}
                        />
                      </Field>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive md:mt-6"
                        aria-label="Убрать липкое сообщение"
                        onClick={() => update((d) => ({ sticky: { ...d.sticky, items: d.sticky.items.filter((_, j) => j !== i) } }))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <TokenTextarea rows={3} max={STICKY_TEXT_MAX} value={item.text} onChange={(text) => set({ text })} />
                  </div>
                );
              })
            )}
          </SectionCard>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
