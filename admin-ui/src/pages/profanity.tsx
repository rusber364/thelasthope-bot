import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Settings } from '@api';
import { ChannelsPicker, MembersPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, NumberField, SaveBar, SectionCard } from '@/components/settings-ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useSettings } from '@/lib/queries';
import { patch, useSectionForm } from '@/lib/settings-form';

type Profanity = Settings['profanity'];

const LEVELS: Record<Profanity['level'], string> = {
  mat: 'Только мат',
  rude: 'Мат и грубые слова (сука, мудак, шлюха…)',
};

const ACTIONS: Record<Profanity['action'], string> = {
  report: 'Только сообщить модераторам — сообщение остаётся',
  delete: 'Удалить сообщение и предупредить',
  mute: 'Удалить, предупредить и мутить за повторы',
};

const CHANNELS_MAX = 25;
const USERS_MAX = 25;
const WORDS_MAX = 50;

/** Свои слова: по одному в строке или через запятую. */
const parseWords = (value: string) => [
  ...new Set(
    value
      .split(/[\n,]/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean),
  ),
];

export function ProfanityPage() {
  const form = useSectionForm('profanity', (s) => ({ profanity: s.profanity }));
  const { draft, update } = form;
  const { data: settings } = useSettings();
  // Слова правятся текстом; в черновик уходит уже разобранный список.
  const [wordsText, setWordsText] = useState<string | null>(null);
  const set = (change: Partial<Profanity>) => update(patch('profanity', change));

  return (
    <>
      <PageHeader
        title="Фильтр мата"
        description="Бот проверяет новые и отредактированные сообщения. Изменения действуют сразу после сохранения, без перезапуска."
      />
      {!draft ? (
        <FormSkeleton cards={2} />
      ) : (
        <>
          <FormErrors errors={form.errors} />
          <SectionCard title="Фильтр" description="Что ловить и что делать с нарушителем.">
            <Field orientation="horizontal" className="items-start">
              <Switch id="profanity-enabled" checked={draft.profanity.enabled} onCheckedChange={(enabled: boolean) => set({ enabled })} />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="profanity-enabled">Фильтр включён</FieldLabel>
                <FieldDescription>Выключи — и бот перестанет проверять сообщения на мат.</FieldDescription>
              </div>
            </Field>
            <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel>Какие слова ловить</FieldLabel>
                <Select
                  items={LEVELS}
                  value={draft.profanity.level}
                  disabled={!draft.profanity.enabled}
                  onValueChange={(level: Profanity['level'] | null) => level && set({ level })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LEVELS) as Profanity['level'][]).map((level) => (
                      <SelectItem key={level} value={level}>
                        {LEVELS[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Оскорбления по национальности и ориентации ловятся на любом уровне.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Что делать</FieldLabel>
                <Select
                  items={ACTIONS}
                  value={draft.profanity.action}
                  disabled={!draft.profanity.enabled}
                  onValueChange={(action: Profanity['action'] | null) => action && set({ action })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTIONS) as Profanity['action'][]).map((action) => (
                      <SelectItem key={action} value={action}>
                        {ACTIONS[action]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Модераторам в любом случае приходит карточка с кнопками «Мут», «Бан», «Пропустить».</FieldDescription>
              </Field>
              {draft.profanity.action !== 'report' && (
                <Field>
                  <FieldLabel htmlFor="warning">Предупреждение в чате</FieldLabel>
                  <NumberField
                    id="warning"
                    min={0}
                    max={60}
                    suffix="секунд висит"
                    value={draft.profanity.warningSeconds}
                    onChange={(warningSeconds) => set({ warningSeconds })}
                  />
                  <FieldDescription>«Без мата, пожалуйста — сообщение удалено». 0 — не предупреждать.</FieldDescription>
                </Field>
              )}
            </FieldGroup>
            {draft.profanity.action === 'mute' && (
              <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="strikes">Нарушений до мута</FieldLabel>
                  <NumberField
                    id="strikes"
                    min={1}
                    max={20}
                    value={draft.profanity.strikesToMute}
                    onChange={(strikesToMute) => set({ strikesToMute })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="window">За сколько времени</FieldLabel>
                  <NumberField
                    id="window"
                    min={1}
                    max={1440}
                    suffix="мин"
                    value={draft.profanity.strikeWindowMinutes}
                    onChange={(strikeWindowMinutes) => set({ strikeWindowMinutes })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mute">Мут</FieldLabel>
                  <NumberField
                    id="mute"
                    min={1}
                    max={10080}
                    suffix="мин"
                    value={draft.profanity.muteMinutes}
                    onChange={(muteMinutes) => set({ muteMinutes })}
                  />
                </Field>
              </FieldGroup>
            )}
            {draft.profanity.enabled && !settings?.alerts.incidentChannelId && (
              <Alert>
                <CircleAlert />
                <AlertDescription>
                  Канал инцидентов не выбран — карточки модераторам не придут
                  {draft.profanity.action === 'report' ? ', а сообщения с матом останутся без внимания' : ''}. Выбери его в{' '}
                  <Link to="/alerts" className="text-primary underline-offset-4 hover:underline">
                    «Оповещениях»
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            )}
          </SectionCard>

          <SectionCard title="Исключения и свои слова">
            <Field>
              <FieldLabel htmlFor="ignored">Каналы без фильтра</FieldLabel>
              <ChannelsPicker
                id="ignored"
                max={CHANNELS_MAX}
                placeholder="Фильтр работает во всех каналах"
                value={draft.profanity.ignoredChannelIds}
                onChange={(ignoredChannelIds) => set({ ignoredChannelIds })}
              />
              <FieldDescription>Например, флуд-канал «18+», где мат разрешён.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="allowed">Кому можно материться везде</FieldLabel>
              <MembersPicker
                id="allowed"
                max={USERS_MAX}
                value={draft.profanity.allowedUserIds}
                onChange={(allowedUserIds) => set({ allowedUserIds })}
              />
              <FieldDescription>
                Фильтр их сообщения не трогает, зато Света ворчит — и за мат, и за то, что админы дали такое право.
              </FieldDescription>
            </Field>
            {draft.profanity.allowedUserIds.length > 0 && (
              <>
                <Field>
                  <FieldLabel htmlFor="scold">Света ворчит не чаще</FieldLabel>
                  <NumberField
                    id="scold"
                    min={0}
                    max={1440}
                    suffix="мин на человека"
                    value={draft.profanity.scoldMinutes}
                    onChange={(scoldMinutes) => set({ scoldMinutes })}
                  />
                  <FieldDescription>
                    0 — на каждое сообщение с матом. В каналах без фильтра Света не ворчит: там мат можно всем.
                  </FieldDescription>
                </Field>
                {settings && !settings.sveta.enabled && (
                  <Alert>
                    <CircleAlert />
                    <AlertDescription>
                      Света выключена — ворчать некому, мат этим людям просто сойдёт с рук. Включи её на странице{' '}
                      <Link to="/sveta" className="text-primary underline-offset-4 hover:underline">
                        «Света»
                      </Link>
                      .
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            <Field>
              <FieldLabel htmlFor="words">Свои слова</FieldLabel>
              <Textarea
                id="words"
                rows={4}
                placeholder={'По одному в строке или через запятую'}
                value={wordsText ?? draft.profanity.extraWords.join('\n')}
                onChange={(event) => {
                  setWordsText(event.target.value);
                  set({ extraWords: parseWords(event.target.value) });
                }}
              />
              <FieldDescription>
                Ловятся как начало слова, на любом уровне: «дурак» поймает и «дураки». Сейчас {draft.profanity.extraWords.length} из{' '}
                {WORDS_MAX}.
              </FieldDescription>
            </Field>
          </SectionCard>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
