import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, ExternalLink, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Settings, SvetaStatus } from '@api';
import { ChannelPicker, ChannelsPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, NumberField, SaveBar, SectionCard } from '@/components/settings-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useOptions } from '@/lib/queries';
import { patch, useSectionForm } from '@/lib/settings-form';

const PERSONA_MAX = 4000;
const CHANNELS_MAX = 10;

/** Шаг подключения: галочка или восклицательный знак и что сделать. */
function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0">{children}</div>
    </li>
  );
}

const code = (text: string) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{text}</code>;

function StatusCard({ perDay }: { perDay: number }) {
  const { data: status } = useQuery({
    queryKey: ['sveta-status'],
    queryFn: () => api.get<SvetaStatus>('/sveta/status'),
    refetchInterval: 15_000,
  });
  const { data: options } = useOptions();
  const channelName = (id: string) => options?.textChannels.find((c) => c.id === id)?.name ?? id;

  return (
    <SectionCard
      title="Подключение"
      description="Света — отдельный бот-аккаунт со своим именем и аватаркой. Отвечает моделью Google Gemini."
    >
      {!status ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            <Step done={status.hasToken}>
              {status.hasToken ? (
                <>Токен Светы есть ({code('SVETA_TOKEN')}).</>
              ) : (
                <>
                  Нет токена: создай в Developer Portal приложение «Света», во вкладке Bot включи Message Content Intent, сбрось токен и
                  впиши его в {code('.env')} строкой {code('SVETA_TOKEN=…')}, потом перезапусти бота.
                </>
              )}
            </Step>
            <Step done={status.connected}>
              {status.connected ? <>Подключена к Discord как {status.tag}.</> : <>Не подключена к Discord — подробности в «Логе бота».</>}
            </Step>
            {status.connected && (
              <Step done={status.onServer}>
                {status.onServer ? (
                  <>Добавлена на сервер.</>
                ) : (
                  <>Ещё не на сервере — пригласи её кнопкой ниже: права только видеть, читать историю, писать и ставить реакции.</>
                )}
              </Step>
            )}
            <Step done={status.hasKey}>
              {status.hasKey ? (
                <>Ключ Gemini есть ({code('GEMINI_API_KEY')}).</>
              ) : (
                <>
                  Нет ключа Gemini: aistudio.google.com → Get API key, впиши в {code('.env')} строкой {code('GEMINI_API_KEY=…')} и
                  перезапусти бота.
                </>
              )}
            </Step>
            {status.channelsWithoutAccess.length > 0 && (
              <Step done={false}>
                В каналах {status.channelsWithoutAccess.map(channelName).join(', ')} у Светы нет прав видеть, читать историю или писать —
                добавь её роль в права этих каналов.
              </Step>
            )}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            {status.inviteUrl && !status.onServer && (
              <Button render={<a href={status.inviteUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
                <ExternalLink /> Пригласить Свету
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              Сегодня ответов: <span className="font-medium text-foreground tabular-nums">{status.today}</span> из {perDay}, запросов к
              Gemini: <span className="font-medium text-foreground tabular-nums">{status.requestsToday}</span>
            </span>
          </div>
          {status.lastError && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>Последняя ошибка · {formatDateTime(status.lastError.at)}</AlertTitle>
              <AlertDescription>{status.lastError.text}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </SectionCard>
  );
}

export function SvetaPage() {
  const form = useSectionForm('sveta', (s) => ({ sveta: s.sveta }));
  const { draft, update } = form;
  const set = (change: Partial<Settings['sveta']>) => update(patch('sveta', change));

  return (
    <>
      <PageHeader
        title="Света"
        description="ИИ-персонаж гильдии: живёт в выбранных каналах, отвечает, когда её зовут («Света, …», упоминание или ответ на её сообщение), и изредка встревает сама."
      />
      {!draft ? (
        <FormSkeleton cards={3} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <StatusCard perDay={draft.sveta.perDay} />

          <SectionCard title="Где живёт" description="Света читает и отвечает только в этих каналах — остальные в Gemini не уходят.">
            <Field orientation="horizontal" className="items-start">
              <Switch id="sveta-enabled" checked={draft.sveta.enabled} onCheckedChange={(enabled: boolean) => set({ enabled })} />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="sveta-enabled">Света включена</FieldLabel>
                <FieldDescription>Выключенная Света молчит, даже если её зовут.</FieldDescription>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="sveta-channels">Каналы</FieldLabel>
              <ChannelsPicker
                id="sveta-channels"
                max={CHANNELS_MAX}
                value={draft.sveta.channelIds}
                onChange={(channelIds) => set({ channelIds })}
              />
              <FieldDescription>
                Бесплатный Gemini может использовать сообщения для улучшения продуктов Google — выбирай общие «весёлые» каналы, а в их
                описании напиши: «Сообщения здесь читает ИИ Света (Google Gemini)».
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="sveta-news">Новости о сборах</FieldLabel>
              <ChannelPicker
                id="sveta-news"
                emptyLabel="Не рассказывать"
                value={draft.sveta.newsChannelId}
                onChange={(newsChannelId) => set({ newsChannelId })}
              />
              <FieldDescription>
                Сюда Света коротко пишет, когда открылась рега, «Сбор!», перенос или отмена. Это заготовленные фразы — лимит Gemini не
                тратится.
              </FieldDescription>
            </Field>
          </SectionCard>

          <SectionCard
            title="Характер"
            description="Кто она и как говорит. Правила чата — коротко, на «ты», без родовых окончаний, без мата и политики — бот добавляет сам."
          >
            <Field>
              <FieldLabel htmlFor="sveta-persona">Характер</FieldLabel>
              <Textarea
                id="sveta-persona"
                rows={6}
                maxLength={PERSONA_MAX}
                value={draft.sveta.persona}
                onChange={(event) => set({ persona: event.target.value })}
              />
              <FieldDescription>
                {draft.sveta.persona.length} / {PERSONA_MAX}
              </FieldDescription>
            </Field>
          </SectionCard>

          <SectionCard title="Модель и потолки" description="Один ответ — один запрос к Gemini. Потолки берегут бесплатный лимит Google.">
            <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="sveta-model">Модель Gemini</FieldLabel>
                <Input id="sveta-model" value={draft.sveta.model} onChange={(event) => set({ model: event.target.value.trim() })} />
                <FieldDescription>
                  Бесплатно доступны модели Flash: {code('gemini-flash-latest')} — умнее, {code('gemini-flash-lite-latest')} — больше
                  запросов в день.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="sveta-random">Встревает сама</FieldLabel>
                <NumberField
                  id="sveta-random"
                  min={0}
                  max={20}
                  suffix="% сообщений"
                  value={draft.sveta.randomPercent}
                  onChange={(randomPercent) => set({ randomPercent })}
                />
                <FieldDescription>0 — только когда зовут. Сама — не чаще раза в 10 минут на канал.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="sveta-cooldown">Пауза для одного человека</FieldLabel>
                <NumberField
                  id="sveta-cooldown"
                  min={0}
                  max={600}
                  suffix="секунд"
                  value={draft.sveta.userCooldownSeconds}
                  onChange={(userCooldownSeconds) => set({ userCooldownSeconds })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sveta-hour">Ответов в час</FieldLabel>
                <NumberField id="sveta-hour" min={1} max={500} value={draft.sveta.perHour} onChange={(perHour) => set({ perHour })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="sveta-day">Ответов в день</FieldLabel>
                <NumberField id="sveta-day" min={1} max={5000} value={draft.sveta.perDay} onChange={(perDay) => set({ perDay })} />
                <FieldDescription>Достигла потолка — один раз скажет, что на перерыве.</FieldDescription>
              </Field>
            </FieldGroup>
          </SectionCard>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
