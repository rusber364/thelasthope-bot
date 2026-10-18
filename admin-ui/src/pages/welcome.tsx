import { useQuery } from '@tanstack/react-query';
import { ClipboardList, DoorOpen, Hash, Mail, MessageSquare, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Option, PollRow } from '@api';
import { ActionButton } from '@/components/action-button';
import { DiscordPreview, type PreviewButton, type PreviewValue } from '@/components/discord-preview';
import { ChannelPicker, RolePicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, SaveBar, SectionCard, TokenTextarea, type Token } from '@/components/settings-ui';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useMe, useOptions, useOverview, useSettings } from '@/lib/queries';
import { patch, useSectionForm } from '@/lib/settings-form';

const TEXT_MAX = 2000;
const BUTTON_MAX = 80;

const WELCOME_TOKENS: Token[] = [
  { token: '{user}', hint: 'Упоминание новичка' },
  { token: '{server}', hint: 'Название сервера' },
  { token: '{rules}', hint: 'Канал правил' },
  { token: '{role}', hint: 'Роль «Гость»' },
];
const DM_TOKENS: Token[] = [
  { token: '{name}', hint: 'Имя новичка' },
  { token: '{user}', hint: 'Упоминание новичка' },
  { token: '{server}', hint: 'Название сервера' },
  { token: '{rules}', hint: 'Канал правил' },
  { token: '{welcome}', hint: 'Канал приветствия' },
  { token: '{role}', hint: 'Роль «Гость»' },
];
const FAREWELL_TOKENS: Token[] = [
  { token: '{user}', hint: 'Упоминание ушедшего' },
  { token: '{name}', hint: 'Имя ушедшего' },
  { token: '{server}', hint: 'Название сервера' },
  { token: '{members}', hint: 'Сколько участников осталось' },
];

/** Примеры для подстановок в предпросмотре — из сохранённых каналов и ролей сервера. */
function usePreviewValues() {
  const { data: settings } = useSettings();
  const { data: options } = useOptions();
  const { data: me } = useMe();
  const { data: overview } = useOverview();
  const find = (list: Option[] | undefined, id: string | null | undefined) => (id ? list?.find((o) => o.id === id) : undefined);
  const channel = (id: string | null | undefined, fallback: string): PreviewValue => {
    const found = find(options?.textChannels, id);
    return found ? { text: found.name, mention: true } : { text: fallback };
  };
  const guest = find(options?.roles, settings?.roles.guest);
  return {
    hasGuestRole: Boolean(guest),
    hasRules: Boolean(settings?.channels.rules),
    welcome: {
      user: { text: '@Новичок', mention: true },
      server: { text: me?.guild.name ?? 'Сервер' },
      rules: channel(settings?.channels.rules, 'правилами'),
      role: { text: guest?.name ?? 'Гость' },
    } satisfies Record<string, PreviewValue>,
    dm: {
      name: { text: 'Новичок' },
      user: { text: '@Новичок', mention: true },
      server: { text: me?.guild.name ?? 'Сервер' },
      rules: channel(settings?.channels.rules, 'правила'),
      welcome: channel(settings?.channels.welcome, 'канале приветствий'),
      role: { text: guest?.name ?? 'Гость' },
    } satisfies Record<string, PreviewValue>,
    farewell: {
      user: { text: '@Ушедший', mention: true },
      name: { text: 'Ушедший' },
      server: { text: me?.guild.name ?? 'Сервер' },
      members: { text: String(Math.max((overview?.members ?? 1) - 1, 0)) },
    } satisfies Record<string, PreviewValue>,
  };
}

/** Форма слева, предпросмотр справа (на узком экране — под формой). */
function WithPreview({ children, preview }: { children: ReactNode; preview: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex flex-col gap-4">{children}</div>
      <div className="flex flex-col gap-2 lg:sticky lg:top-20">
        <div className="text-sm font-medium text-muted-foreground">Так это увидят в Discord</div>
        {preview}
      </div>
    </div>
  );
}

/** Канала авторизации больше нет: если в тексте остался {auth}, бот подставит просто слово «авторизацию». */
function LegacyAuthHint({ text }: { text: string }) {
  if (!text.includes('{auth}')) return null;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      Канала авторизации больше нет — убери <code>{'{auth}'}</code> из текста, иначе бот напишет просто «авторизацию».
    </p>
  );
}

const dot = (form: { dirty: boolean }) => form.dirty && <span className="size-1.5 rounded-full bg-primary" aria-label="есть изменения" />;

export function WelcomePage() {
  const welcome = useSectionForm('welcome', (s) => ({ welcome: s.welcome }));
  const dm = useSectionForm('welcomeDm', (s) => ({ welcomeDm: s.welcomeDm }));
  const farewell = useSectionForm('farewell', (s) => ({ farewell: s.farewell }));
  const onboarding = useSectionForm('onboarding', (s) => ({ onboarding: s.onboarding }));
  const { data: polls } = useQuery({ queryKey: ['polls'], queryFn: () => api.get<PollRow[]>('/polls') });
  const { data: settings } = useSettings();
  const values = usePreviewValues();
  // ?tab=onboarding — сразу на вкладку анкеты (ссылка со страницы опроса).
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'channel');
  const active = tab === 'dm' ? dm : tab === 'farewell' ? farewell : tab === 'onboarding' ? onboarding : welcome;

  if (!welcome.draft || !dm.draft || !farewell.draft || !onboarding.draft) {
    return (
      <>
        <PageHeader title="Приветствие" />
        <FormSkeleton />
      </>
    );
  }
  const w = welcome.draft.welcome;
  const d = dm.draft.welcomeDm;
  const f = farewell.draft.farewell;
  const o = onboarding.draft.onboarding;
  // Анкета в приветствии видна, только если выбран открытый опрос.
  const survey = polls?.find((poll) => poll.id === o.pollId);
  const offerSurvey = Boolean(survey && !survey.closed);
  const pollItems: Record<string, string> = { '': 'Не предлагать' };
  for (const poll of polls ?? []) {
    if (!poll.closed || poll.id === o.pollId) pollItems[String(poll.id)] = `#${poll.id} ${poll.title}${poll.closed ? ' (закрыт)' : ''}`;
  }

  const welcomeButtons: PreviewButton[] = [
    ...(values.hasGuestRole ? [{ label: w.guestButton, emoji: '🎟️', style: 'success' as const }] : []),
    ...(offerSurvey ? [{ label: o.button, emoji: '📝', style: 'primary' as const }] : []),
    ...(values.hasRules ? [{ label: w.rulesButton, emoji: '📖', style: 'link' as const }] : []),
  ];
  // Анкета «и в личку» приходит кнопкой в том же сообщении.
  const surveyInDm = offerSurvey && o.dm;
  const dmButtons: PreviewButton[] = [
    ...(surveyInDm ? [{ label: o.button, emoji: '📝', style: 'primary' as const }] : []),
    ...(values.hasRules ? [{ label: w.rulesButton, emoji: '📖', style: 'link' as const }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Приветствие"
        description={
          <>
            Что бот пишет новичкам и когда кто-то уходит с сервера. Разметка Discord работает: <code>**жирный**</code>,{' '}
            <code>*курсив*</code>, эмодзи.
          </>
        }
      />
      <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="gap-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="channel">
            <MessageSquare /> В канале {dot(welcome)}
          </TabsTrigger>
          <TabsTrigger value="dm">
            <Mail /> В личку {dot(dm)}
          </TabsTrigger>
          <TabsTrigger value="farewell">
            <DoorOpen /> Прощание {dot(farewell)}
          </TabsTrigger>
          <TabsTrigger value="onboarding">
            <ClipboardList /> Анкета {dot(onboarding)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="channel">
          <WithPreview
            preview={
              <DiscordPreview
                card
                parts={[w.text, values.hasGuestRole ? w.guestOffer : '', offerSurvey ? o.offer : '']}
                values={values.welcome}
                buttons={welcomeButtons}
              />
            }
          >
            <FormErrors errors={welcome.errors} />
            <SectionCard
              title="Приветствие в канале"
              description={
                <>
                  Бот пишет в канал приветствия, когда кто-то заходит на сервер. Канал выбирается в разделе{' '}
                  <Link to="/channels" className="text-primary underline-offset-4 hover:underline">
                    «Каналы и роли»
                  </Link>
                  .
                </>
              }
              action={
                <ActionButton path="/welcome/test" icon={<Send />} dirty={welcome.dirty}>
                  Пробное
                </ActionButton>
              }
            >
              <Field>
                <FieldLabel htmlFor="welcome-text">Текст приветствия</FieldLabel>
                <TokenTextarea
                  id="welcome-text"
                  rows={5}
                  max={TEXT_MAX}
                  tokens={WELCOME_TOKENS}
                  value={w.text}
                  onChange={(text) => welcome.update(patch('welcome', { text }))}
                />
                <LegacyAuthHint text={w.text} />
              </Field>
              <Field>
                <FieldLabel htmlFor="guest-offer">Предложение роли «Гость»</FieldLabel>
                <TokenTextarea
                  id="guest-offer"
                  rows={2}
                  max={TEXT_MAX}
                  tokens={WELCOME_TOKENS}
                  value={w.guestOffer}
                  onChange={(guestOffer) => welcome.update(patch('welcome', { guestOffer }))}
                />
                <LegacyAuthHint text={w.guestOffer} />
                <FieldDescription>Показывается, только если роль «Гость» выбрана.</FieldDescription>
              </Field>
              <FieldGroup className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="guest-button">Кнопка роли</FieldLabel>
                  <Input
                    id="guest-button"
                    maxLength={BUTTON_MAX}
                    value={w.guestButton}
                    onChange={(e) => welcome.update(patch('welcome', { guestButton: e.target.value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="rules-button">Кнопка правил</FieldLabel>
                  <Input
                    id="rules-button"
                    maxLength={BUTTON_MAX}
                    value={w.rulesButton}
                    onChange={(e) => welcome.update(patch('welcome', { rulesButton: e.target.value }))}
                  />
                  <FieldDescription>Эта же подпись — у кнопки в личке.</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </WithPreview>
        </TabsContent>

        <TabsContent value="dm">
          <WithPreview
            preview={<DiscordPreview parts={[d.text, surveyInDm ? `📝 ${o.offer}` : '']} values={values.dm} buttons={dmButtons} />}
          >
            <FormErrors errors={dm.errors} />
            <SectionCard
              title="Приветствие в личку"
              description="Кроме приветствия в канале, бот может написать новичку в личные сообщения: памятку и кнопку-ссылку на правила. Если у новичка закрыта личка, бот просто пропустит его."
              action={
                <ActionButton path="/welcome/dm/test" icon={<Send />} dirty={dm.dirty}>
                  Пробное мне
                </ActionButton>
              }
            >
              <Field orientation="horizontal" className="items-center">
                <Switch
                  id="dm-enabled"
                  checked={d.enabled}
                  onCheckedChange={(enabled: boolean) => dm.update(patch('welcomeDm', { enabled }))}
                />
                <FieldLabel htmlFor="dm-enabled">Присылать новичкам в личку</FieldLabel>
              </Field>
              <Field>
                <FieldLabel htmlFor="dm-text">Текст</FieldLabel>
                <TokenTextarea
                  id="dm-text"
                  rows={7}
                  max={TEXT_MAX}
                  tokens={DM_TOKENS}
                  value={d.text}
                  onChange={(text) => dm.update(patch('welcomeDm', { text }))}
                />
                <LegacyAuthHint text={d.text} />
                <FieldDescription>Пробное сообщение приходит с сохранённым текстом, даже если отправка выключена.</FieldDescription>
              </Field>
            </SectionCard>
          </WithPreview>
        </TabsContent>

        <TabsContent value="farewell">
          <WithPreview preview={<DiscordPreview parts={[f.text]} values={values.farewell} />}>
            <FormErrors errors={farewell.errors} />
            <SectionCard
              title="Прощание"
              description="Когда участник уходит с сервера, бот пишет в выбранный канал."
              action={
                <ActionButton path="/farewell/test" icon={<Send />} dirty={farewell.dirty}>
                  Пробное
                </ActionButton>
              }
            >
              <Field>
                <FieldLabel htmlFor="farewell-channel">
                  <Hash className="size-3.5" /> Канал прощаний
                </FieldLabel>
                <ChannelPicker
                  id="farewell-channel"
                  emptyLabel="Не публиковать"
                  value={f.channelId}
                  onChange={(channelId) => farewell.update(patch('farewell', { channelId }))}
                />
                <FieldDescription>Без выбора прощания не публикуются.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="farewell-text">Текст прощания</FieldLabel>
                <TokenTextarea
                  id="farewell-text"
                  rows={3}
                  max={TEXT_MAX}
                  tokens={FAREWELL_TOKENS}
                  value={f.text}
                  onChange={(text) => farewell.update(patch('farewell', { text }))}
                />
              </Field>
            </SectionCard>
          </WithPreview>
        </TabsContent>

        <TabsContent value="onboarding">
          <WithPreview
            preview={
              <DiscordPreview
                card
                parts={[w.text, values.hasGuestRole ? w.guestOffer : '', offerSurvey ? o.offer : '']}
                values={values.welcome}
                buttons={welcomeButtons}
              />
            }
          >
            <FormErrors errors={onboarding.errors} />
            <SectionCard
              title="Анкета для новичков"
              description="Опрос, который бот предлагает каждому новичку кнопкой в приветствии. Когда анкету заполнили до конца, бот может выдать роль, снять другую и прислать офицерам карточку с ответами."
            >
              <Field>
                <FieldLabel>Анкета</FieldLabel>
                <Select
                  items={pollItems}
                  value={o.pollId === null ? '' : String(o.pollId)}
                  onValueChange={(value: string | null) => onboarding.update(patch('onboarding', { pollId: value ? Number(value) : null }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(pollItems).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Анкета — обычный опрос из раздела{' '}
                  <Link to="/polls" className="text-primary underline-offset-4 hover:underline">
                    «Опросы»
                  </Link>
                  . Чтобы поменять вопросы, сделай копию опроса, поправь, опубликуй и выбери здесь новую.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="onboarding-offer">Строка в приветствии</FieldLabel>
                <TokenTextarea
                  id="onboarding-offer"
                  rows={2}
                  max={TEXT_MAX}
                  tokens={WELCOME_TOKENS}
                  value={o.offer}
                  onChange={(offer) => onboarding.update(patch('onboarding', { offer }))}
                />
                <LegacyAuthHint text={o.offer} />
              </Field>
              <Field>
                <FieldLabel htmlFor="onboarding-button">Кнопка</FieldLabel>
                <Input
                  id="onboarding-button"
                  maxLength={BUTTON_MAX}
                  value={o.button}
                  onChange={(e) => onboarding.update(patch('onboarding', { button: e.target.value }))}
                />
              </Field>
              <Field orientation="horizontal" className="items-start">
                <Switch
                  id="onboarding-dm"
                  checked={o.dm}
                  onCheckedChange={(dm: boolean) => onboarding.update(patch('onboarding', { dm }))}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="onboarding-dm">И в личку</FieldLabel>
                  <FieldDescription>
                    Новичку придёт личное сообщение с этой строкой и кнопкой анкеты — вместе с приветствием в личку, а если оно выключено,
                    отдельно. Анкету можно пройти прямо в личке.
                  </FieldDescription>
                </div>
              </Field>
            </SectionCard>

            <SectionCard title="Когда анкету заполнили" description="Срабатывает и для тех, кто прошёл анкету из её публикации в канале.">
              <FieldGroup className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="onboarding-role">Выдать роль</FieldLabel>
                  <RolePicker
                    id="onboarding-role"
                    emptyLabel="Не выдавать"
                    value={o.roleId}
                    onChange={(roleId) => onboarding.update(patch('onboarding', { roleId }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="onboarding-remove">Снять роль</FieldLabel>
                  <RolePicker
                    id="onboarding-remove"
                    emptyLabel="Не снимать"
                    value={o.removeRoleId}
                    onChange={(removeRoleId) => onboarding.update(patch('onboarding', { removeRoleId }))}
                  />
                  <FieldDescription>Например, «Незнакомец».</FieldDescription>
                </Field>
              </FieldGroup>
              <Field orientation="horizontal" className="items-start">
                <Switch
                  id="onboarding-notify"
                  checked={o.notify}
                  onCheckedChange={(notify: boolean) => onboarding.update(patch('onboarding', { notify }))}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="onboarding-notify">Карточка офицерам с ответами</FieldLabel>
                  <FieldDescription>
                    В канал оповещений, с упоминанием роли офицеров.{' '}
                    {!settings?.alerts.channelId && (
                      <>
                        Канал оповещений не выбран —{' '}
                        <Link to="/alerts" className="text-primary underline-offset-4 hover:underline">
                          выбери в «Оповещениях»
                        </Link>
                        .
                      </>
                    )}
                  </FieldDescription>
                </div>
              </Field>
            </SectionCard>

            <SectionCard
              title="Тем, кто уже на сервере"
              description="Чтобы предложить анкету гостям, которые зашли раньше, опубликуй её в «Опросах» в нужном канале с упоминанием роли (например, @Гость). Подпись кнопки под опросом задаётся строкой «Кнопка: Пройти анкету» в тексте опроса. Роль и карточка офицерам сработают так же."
            >
              <Link to="/polls" className="text-sm text-primary underline-offset-4 hover:underline">
                Перейти к опросам →
              </Link>
            </SectionCard>
          </WithPreview>
        </TabsContent>
      </Tabs>
      <SaveBar form={active} />
    </>
  );
}
