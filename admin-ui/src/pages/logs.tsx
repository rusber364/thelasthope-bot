import { FileClock, Mic, MessageSquareText, Send, Server, Shield, Swords, UserPlus, type LucideIcon } from 'lucide-react';
import { LOG_CATEGORY_IDS, type LogCategory } from '@api';
import { ActionButton } from '@/components/action-button';
import { ChannelPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, SaveBar, SectionCard } from '@/components/settings-ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { useSectionForm } from '@/lib/settings-form';
import { cn } from '@/lib/utils';

const LOGS: Record<LogCategory, { title: string; hint: string; icon: LucideIcon }> = {
  members: { title: 'лог-дискорда', hint: 'Вход и выход участников.', icon: UserPlus },
  server: { title: 'лог-сервер', hint: 'Каналы, роли, ники, настройки сервера и админки.', icon: Server },
  messages: { title: 'лог-сообщения', hint: 'Удалённые и изменённые сообщения.', icon: MessageSquareText },
  voice: { title: 'лог-голос', hint: 'Вход, выход и переходы в голосовых каналах.', icon: Mic },
  moderation: { title: 'лог-модерация', hint: 'Кики, баны, муты, очистка, мат.', icon: Shield },
  raids: { title: 'лог-рейдов', hint: 'Запись на реги, смена спека, «под вопросом», отписки.', icon: Swords },
};

export function LogsPage() {
  const form = useSectionForm('logs', (s) => ({ logs: s.logs }));
  const { draft, update } = form;

  return (
    <>
      <PageHeader
        title="Логи"
        description="В какой канал бот пишет каждый вид событий. Выключи переключатель, чтобы временно остановить лог."
        actions={
          <ActionButton path="/logs/test" icon={<Send />} dirty={form.dirty}>
            Тест в лог-каналы
          </ActionButton>
        }
      />
      {!draft ? (
        <FormSkeleton cards={1} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Каналы журналов" description="Бот присылает карточку на каждое событие: кто, что и когда.">
            <div className="flex flex-col divide-y">
              {LOG_CATEGORY_IDS.map((category) => {
                const entry = draft.logs[category];
                const info = LOGS[category];
                const set = (change: Partial<typeof entry>) =>
                  update((d) => ({ logs: { ...d.logs, [category]: { ...d.logs[category], ...change } } }));
                return (
                  <div
                    key={category}
                    className="grid items-center gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)_auto]"
                  >
                    <div className={cn('flex items-start gap-3', !entry.enabled && 'opacity-60')}>
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                        <info.icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium">{info.title}</div>
                        <div className="text-xs text-muted-foreground">{info.hint}</div>
                      </div>
                    </div>
                    <ChannelPicker value={entry.channelId} onChange={(channelId) => set({ channelId })} />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground md:justify-end">
                      <Switch
                        checked={entry.enabled}
                        onCheckedChange={(enabled: boolean) => set({ enabled })}
                        aria-label={`${info.title}: включено`}
                      />
                      <span className="md:hidden">Включено</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </SectionCard>
          <Alert>
            <FileClock />
            <AlertDescription>
              Для «лог-сервер» и «лог-модерация» у роли бота должно быть право «Просматривать журнал аудита» — только из журнала видно, кто
              сделал действие.
            </AlertDescription>
          </Alert>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
