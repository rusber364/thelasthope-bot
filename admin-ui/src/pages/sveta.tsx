import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookUser,
  Brain,
  ChevronRight,
  Cpu,
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { Settings, SvetaPerson, SvetaStatus } from '@api';
import { ChannelPicker, ChannelsPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, NumberField, SaveBar, SectionCard } from '@/components/settings-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, errorText } from '@/lib/api';
import { formatDate, formatDateTime, todayInKyiv } from '@/lib/format';
import { loreFile, mergeLore, parseLoreFile } from '@/lib/lore';
import { useOptions, useSettings } from '@/lib/queries';
import { patch, useSectionForm } from '@/lib/settings-form';

const PERSONA_MAX = 4000;
const EXAMPLES_MAX = 12;
const EXAMPLE_MAX = 300;
const LORE_MAX = 50;
const STORY_MAX = 1000;
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

/** Модель OpenRouter — с «/» в имени (vendor/model), Gemini — без. */
const isOpenRouter = (model: string) => model.includes('/');

/** Значение «без запасной» в списке выбора: пустую строку Select за значение не считает. */
const NO_FALLBACK = '—';
const MODELS_MAX = 20;

/** Список моделей: метки с видом (Gemini или OpenRouter), убрать ненужную, добавить новую по имени. */
function ModelsEditor({ models, inUse, onChange }: { models: string[]; inUse: string[]; onChange: (models: string[]) => void }) {
  const [name, setName] = useState('');
  const id = name.trim().toLowerCase();
  const canAdd = Boolean(id) && !models.includes(id) && models.length < MODELS_MAX;
  const add = () => {
    if (!canAdd) return;
    onChange([...models, id]);
    setName('');
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {models.map((model) => {
          const used = inUse.includes(model);
          return (
            <li key={model} className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs">
              <span className="truncate font-mono">{model}</span>
              <Badge variant="outline">{isOpenRouter(model) ? 'OpenRouter' : 'Gemini'}</Badge>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Убрать ${model}`}
                title={used ? 'Выбрана основной или запасной — сначала выбери другую' : 'Убрать из списка'}
                disabled={used}
                onClick={() => onChange(models.filter((m) => m !== model))}
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Input
          id="sveta-new-model"
          className="font-mono text-xs"
          placeholder="gemini-flash-latest или vendor/model"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" disabled={!canAdd} onClick={add}>
          <Plus /> Добавить
        </Button>
      </div>
      <FieldDescription>
        {models.includes(id) ? 'Эта модель уже в списке. ' : ''}До {MODELS_MAX} моделей. Имя — как у сервиса: Gemini без «/», OpenRouter —{' '}
        {code('vendor/model')} со страницы модели на openrouter.ai.
      </FieldDescription>
    </div>
  );
}

type Thinking = Settings['sveta']['thinking'];
const THINKING: Record<Thinking, string> = {
  low: 'Низкое — быстро и дёшево',
  medium: 'Среднее',
  high: 'Высокое — продуманнее, но медленнее и дороже',
};

type Spend = SvetaStatus['spend'][number];
const tokenCount = new Intl.NumberFormat('ru-RU');
/** Стоимость в долларах: null — сервис её не сообщает (Gemini), 0 — бесплатно. */
const costText = (cost: number | null) => (cost === null ? '—' : cost === 0 ? 'бесплатно' : `$${Number(cost.toPrecision(3))}`);

/** Расход по моделям за все дни из ответа (7 дней) и запросы за сегодня; самые занятые модели — сверху. */
function spendByModel(spend: Spend[], today: string) {
  const models = new Map<string, Spend & { today: number }>();
  for (const row of spend) {
    const sum = models.get(row.model) ?? { day: today, model: row.model, today: 0, requests: 0, input: 0, output: 0, cost: null };
    models.set(row.model, {
      ...sum,
      today: sum.today + (row.day === today ? row.requests : 0),
      requests: sum.requests + row.requests,
      input: sum.input + row.input,
      output: sum.output + row.output,
      cost: sum.cost === null && row.cost === null ? null : (sum.cost ?? 0) + (row.cost ?? 0),
    });
  }
  return [...models.values()].sort((a, b) => b.requests - a.requests);
}

/** Сколько запросов, токенов и денег ушло на каждую модель — чтобы попробовать новую и увидеть, во что она обходится. */
function SpendTable({ spend }: { spend: Spend[] }) {
  const rows = spendByModel(spend, todayInKyiv());
  return (
    // w-0 min-w-full: ширина таблицы не распирает страницу — на узком экране она прокручивается внутри своего блока.
    <div className="flex w-0 min-w-full flex-col gap-2">
      <h3 className="text-sm font-medium">Расход по моделям за 7 дней</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Запросов к моделям ещё не было.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Модель</TableHead>
              <TableHead className="text-right whitespace-normal">Запросов: сегодня / 7 дней</TableHead>
              <TableHead className="text-right whitespace-normal">Токенов: вход → выход</TableHead>
              <TableHead className="text-right">Стоимость</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.model}>
                <TableCell className="font-mono text-xs whitespace-normal wrap-anywhere">{row.model}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.today} / {row.requests}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {tokenCount.format(row.input)} → {tokenCount.format(row.output)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{costText(row.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Дни — по Киеву; неудачные запросы тоже считаются. Стоимость в долларах присылает OpenRouter, у бесплатных моделей — «бесплатно».
        Gemini стоимость не сообщает — там «—»: бесплатный тариф Google ничего не стоит, а платный считай по его ценам за токены.
      </p>
    </div>
  );
}

/** Состояние Светы: подключение, ответы за сегодня, расход. Обновляется само — его читают «Подключение» и «Расход». */
const useSvetaStatus = () =>
  useQuery({ queryKey: ['sveta-status'], queryFn: () => api.get<SvetaStatus>('/sveta/status'), refetchInterval: 15_000 });

/** Сколько Света ответила сегодня и во что обходятся модели. */
function UsageCard({ perDay }: { perDay: number }) {
  const { data: status } = useSvetaStatus();
  return (
    <SectionCard title="Расход" description="Ответы за сегодня и траты по моделям. Обновляется само.">
      {!status ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Сегодня ответов: <span className="font-medium text-foreground tabular-nums">{status.today}</span> из {perDay}, запросов к
            моделям: <span className="font-medium text-foreground tabular-nums">{status.requestsToday}</span>
          </p>
          <SpendTable spend={status.spend} />
        </div>
      )}
    </SectionCard>
  );
}

function StatusCard({ models }: { models: string[] }) {
  const needsGemini = models.some((m) => m && !isOpenRouter(m));
  const needsOpenRouter = models.some(isOpenRouter);
  const { data: status } = useSvetaStatus();
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
            {needsGemini && (
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
            )}
            {needsOpenRouter && (
              <Step done={status.hasOpenRouterKey}>
                {status.hasOpenRouterKey ? (
                  <>Ключ OpenRouter есть ({code('OPENROUTER_API_KEY')}).</>
                ) : (
                  <>
                    Нет ключа OpenRouter: openrouter.ai/keys → Create Key, впиши в {code('.env')} строкой {code('OPENROUTER_API_KEY=…')} и
                    перезапусти бота.
                  </>
                )}
              </Step>
            )}
            {status.channelsWithoutAccess.length > 0 && (
              <Step done={false}>
                В каналах {status.channelsWithoutAccess.map(channelName).join(', ')} у Светы нет прав видеть, читать историю или писать —
                добавь её роль в права этих каналов.
              </Step>
            )}
          </ul>
          {status.inviteUrl && !status.onServer && (
            <Button className="w-fit" render={<a href={status.inviteUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
              <ExternalLink /> Пригласить Свету
            </Button>
          )}
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

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const notesText = (person: SvetaPerson) => person.notes.map((note) => note.text).join('\n');

/** Один человек: отношение, прозвище, заметки — правка и «стереть». */
function PersonRow({ person }: { person: SvetaPerson }) {
  const queryClient = useQueryClient();
  const [attitude, setAttitude] = useState(person.attitude);
  const [nickname, setNickname] = useState(person.nickname ?? '');
  const [notes, setNotes] = useState(notesText(person));
  const dirty = attitude !== person.attitude || nickname !== (person.nickname ?? '') || notes !== notesText(person);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sveta-people'] });

  const save = useMutation({
    mutationFn: () => api.put<SvetaPerson>(`/sveta/people/${person.userId}`, { attitude, nickname, notes: notes.split('\n') }),
    onSuccess: () => {
      toast.success('Сохранено.');
      void refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const forget = useMutation({
    mutationFn: () => api.delete(`/sveta/people/${person.userId}`),
    onSuccess: (result) => {
      toast.success(result.message);
      void refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const tone = person.attitude <= -20 ? 'bg-destructive/15 text-destructive' : person.attitude >= 20 ? 'bg-success/15 text-success' : '';
  const id = (field: string) => `person-${person.userId}-${field}`;
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{person.name}</span>
          {person.nickname && <span className="text-muted-foreground"> · «{person.nickname}»</span>}
        </span>
        <Badge variant="secondary" className={tone}>
          {signed(person.attitude)}
        </Badge>
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatDateTime(person.updatedAt)}</span>
      </summary>
      <div className="flex flex-col gap-4 border-t px-4 py-3">
        {(person.firstSeen !== null || person.reasons.length > 0) && (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {person.firstSeen !== null && person.lastSeen !== null && (
              <p>
                Знакомы с {formatDate(person.firstSeen)} · разговоров: {person.talks} · последний — {formatDateTime(person.lastSeen)}
              </p>
            )}
            {person.reasons.map((reason) => (
              <p key={`${reason.at}-${reason.text}`}>
                {reason.change > 0 ? 'Порадовало' : 'Обидело'} ({signed(reason.change)}, {formatDate(reason.at)}): {reason.text}
              </p>
            ))}
          </div>
        )}
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id('attitude')}>Отношение</FieldLabel>
            <NumberField id={id('attitude')} min={-100} max={100} value={attitude} onChange={setAttitude} />
            <FieldDescription>−100 — терпеть не может, 0 — нейтрально, +100 — обожает.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={id('nickname')}>Прозвище</FieldLabel>
            <Input id={id('nickname')} maxLength={32} value={nickname} onChange={(event) => setNickname(event.target.value)} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={id('notes')}>Заметки</FieldLabel>
            <Textarea id={id('notes')} rows={6} value={notes} onChange={(event) => setNotes(event.target.value)} />
            <FieldDescription>По одной на строку: до 30 заметок, каждая до 200 символов.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" disabled={forget.isPending} />}>
              <Trash2 /> Стереть
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Стереть память Светы — {person.name}?</AlertDialogTitle>
                <AlertDialogDescription>Света забудет отношение, прозвище и заметки. Вернуть их не получится.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={() => forget.mutate()}>Стереть</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </details>
  );
}

/** Что Света помнит о людях: список с поиском. */
function MemoryCard() {
  const { data: people } = useQuery({ queryKey: ['sveta-people'], queryFn: () => api.get<SvetaPerson[]>('/sveta/people') });
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const shown = people?.filter((p) => `${p.name} ${p.nickname ?? ''}`.toLowerCase().includes(query)) ?? [];

  return (
    <SectionCard
      title="Память о людях"
      description="Отношение, прозвище и заметки о каждом. Света меняет их сама — только о том, кто к ней обратился. Участник может спросить «Света, что ты обо мне помнишь?» или попросить «Света, забудь меня»."
    >
      {!people ? (
        <Skeleton className="h-20 w-full" />
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Света пока ни о ком ничего не помнит.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {people.length > 5 && (
            <Input placeholder="Поиск по нику или прозвищу" value={search} onChange={(event) => setSearch(event.target.value)} />
          )}
          {shown.map((person) => (
            <PersonRow key={`${person.userId}-${person.updatedAt}`} person={person} />
          ))}
          {shown.length === 0 && <p className="text-sm text-muted-foreground">Никого не нашлось.</p>}
        </div>
      )}
    </SectionCard>
  );
}

type Lore = Settings['sveta']['lore'];

/** Имя и ники через запятую. Текст поля — свой, чтобы запятые и пробелы не «прыгали» при наборе. */
function NamesInput({ id, names, onChange }: { id: string; names: string[]; onChange: (names: string[]) => void }) {
  const [text, setText] = useState(names.map((name) => name.trim()).join(', '));
  return (
    <Input
      id={id}
      placeholder="Имя и другие ники через запятую: Эльын, Нобухидзе"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split(','));
      }}
    />
  );
}

/** Истории о людях: карточка на человека — кто (имя и ники) и что Света о нём знает. */
function LoreEditor({ lore, onChange }: { lore: Lore; onChange: (lore: Lore) => void }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  // Новая (пустая) карточка видна всегда, чтобы её можно было заполнить и при включённом поиске.
  const shown = lore
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) => !query || !entry.names.join('').trim() || `${entry.names.join(' ')} ${entry.story}`.toLowerCase().includes(query),
    );
  const change = (index: number, next: Partial<Lore[number]>) => onChange(lore.map((e, i) => (i === index ? { ...e, ...next } : e)));
  const fileInput = useRef<HTMLInputElement>(null);

  /** Скачать то, что сейчас на вкладке, — файлом sveta-lore-<дата>.json. */
  const download = () => {
    const url = URL.createObjectURL(new Blob([loreFile(lore)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sveta-lore-${todayInKyiv()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /** Загрузить файл: новые люди — в конец, совпало имя — история обновится. Сохраняется общей кнопкой. */
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const incoming = parseLoreFile(await file.text());
    if (!incoming) {
      toast.error('Это не файл историй Светы.');
      return;
    }
    const { lore: next, added, updated } = mergeLore(lore, incoming);
    if (!added && !updated) {
      toast.info('Все истории из файла уже есть.');
      return;
    }
    onChange(next);
    toast.success(`Из файла: новых — ${added}, обновлено — ${updated}. Проверь и нажми «Сохранить».`);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Что Света знает о людях гильдии: привычки, мемы, старые истории. Историю она вспоминает, когда человека называют в разговоре или он
        сам пишет, — и может шутить по её мотивам прямо в чате. Пиши только то, над чем людям нормально посмеяться. Света эти истории только
        читает.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={lore.length >= LORE_MAX} onClick={() => onChange([{ names: [], story: '' }, ...lore])}>
          <Plus /> Добавить человека
        </Button>
        <Button variant="outline" disabled={!lore.length} onClick={download}>
          <Download /> Скачать истории
        </Button>
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <Upload /> Загрузить истории
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = ''; // тот же файл можно выбрать ещё раз
          }}
        />
        {lore.length > 4 && (
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Поиск по имени или истории"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}
        <span className="text-sm text-muted-foreground">
          {lore.length} из {LORE_MAX}
        </span>
      </div>
      {lore.length === 0 && <p className="text-sm text-muted-foreground">Историй пока нет — добавь первого человека.</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {shown.map(({ entry, index }) => (
          <SectionCard
            // При добавлении и удалении карточки пересоздаются — у полей «Кто» не останется чужого текста.
            key={`${index}-${lore.length}`}
            title={entry.names.filter((n) => n.trim()).join(', ') || 'Новый человек'}
            action={
              <Button variant="ghost" size="icon" aria-label="Удалить историю" onClick={() => onChange(lore.filter((_, i) => i !== index))}>
                <Trash2 />
              </Button>
            }
          >
            <Field>
              <FieldLabel htmlFor={`lore-names-${index}`}>Кто</FieldLabel>
              <NamesInput id={`lore-names-${index}`} names={entry.names} onChange={(names) => change(index, { names })} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`lore-story-${index}`}>История</FieldLabel>
              <Textarea
                id={`lore-story-${index}`}
                rows={5}
                maxLength={STORY_MAX}
                value={entry.story}
                onChange={(event) => change(index, { story: event.target.value })}
              />
              <FieldDescription>
                {entry.story.length} / {STORY_MAX}
              </FieldDescription>
            </Field>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

type Examples = Settings['sveta']['examples'];

/** Примеры реплик: что написал игрок и как ответила Света. Модель берёт из них тон, а не факты. */
function ExamplesEditor({ examples, onChange }: { examples: Examples; onChange: (examples: Examples) => void }) {
  const change = (index: number, next: Partial<Examples[number]>) =>
    onChange(examples.map((e, i) => (i === index ? { ...e, ...next } : e)));
  return (
    <div className="flex flex-col gap-3">
      {examples.map((example, index) => (
        // При удалении пары поля пересоздаются — в соседних не останется чужого текста.
        <div key={`${index}-${examples.length}`} className="flex items-start gap-2 rounded-xl border p-3">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">
            <Input
              aria-label={`Игрок, пример ${index + 1}`}
              placeholder="Игрок: Света, мы опять вайпнулись 😭"
              maxLength={EXAMPLE_MAX}
              value={example.user}
              onChange={(event) => change(index, { user: event.target.value })}
            />
            <Textarea
              aria-label={`Света, пример ${index + 1}`}
              placeholder="Света: Опять? Ставлю вам кружку «за упорство» 🍺"
              rows={2}
              maxLength={EXAMPLE_MAX}
              value={example.reply}
              onChange={(event) => change(index, { reply: event.target.value })}
            />
          </div>
          <Button variant="ghost" size="icon" aria-label="Удалить пример" onClick={() => onChange(examples.filter((_, i) => i !== index))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={examples.length >= EXAMPLES_MAX}
          onClick={() => onChange([...examples, { user: '', reply: '' }])}
        >
          <Plus /> Добавить пример
        </Button>
        <span className="text-sm text-muted-foreground">
          {examples.length} из {EXAMPLES_MAX}
        </span>
      </div>
    </div>
  );
}

const dot = (dirty: boolean) => dirty && <span className="size-1.5 rounded-full bg-primary" aria-label="есть изменения" />;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Поля вкладки «Модель»: список моделей, основная и запасная, обдумывание, потолки. */
const MODEL_FIELDS = ['models', 'model', 'fallbackModel', 'thinking', 'randomPercent', 'userCooldownSeconds', 'perHour', 'perDay'] as const;

export function SvetaPage() {
  const form = useSectionForm('sveta', (s) => ({ sveta: s.sveta }));
  const { draft, update } = form;
  const set = (change: Partial<Settings['sveta']>) => update(patch('sveta', change));
  // ?tab=lore — сразу на вкладку историй.
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'settings');
  const { data: settings } = useSettings();
  const saved = settings?.sveta;
  const loreDirty = Boolean(draft && saved && !same(draft.sveta.lore, saved.lore));
  const modelDirty = Boolean(draft && saved && MODEL_FIELDS.some((key) => !same(draft.sveta[key], saved[key])));
  // «Настройки» — всё, кроме историй и полей вкладки «Модель».
  const rest = (sveta: Settings['sveta']) => ({ ...sveta, lore: [], ...Object.fromEntries(MODEL_FIELDS.map((key) => [key, null])) });
  const settingsDirty = Boolean(draft && saved && !same(rest(draft.sveta), rest(saved)));
  const { data: status } = useSvetaStatus();

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
          <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="gap-6">
            <TabsList className="w-full max-sm:[&_svg]:hidden sm:w-fit">
              <TabsTrigger value="settings">
                <Settings2 /> Настройки {dot(settingsDirty)}
              </TabsTrigger>
              <TabsTrigger value="model">
                <Cpu /> Модель {dot(modelDirty)}
              </TabsTrigger>
              <TabsTrigger value="lore">
                {/* На телефоне четыре вкладки влезают только с короткой подписью и без значков. */}
                <BookUser /> <span className="sm:hidden">Истории</span>
                <span className="hidden sm:inline">Истории о людях</span> {dot(loreDirty)}
              </TabsTrigger>
              <TabsTrigger value="memory">
                <Brain /> Память
              </TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="flex flex-col gap-6">
              <StatusCard models={[draft.sveta.model, draft.sveta.fallbackModel]} />

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
                description="Кто она, что любит и как говорит. Можно ли ей материться и насколько жёстко шутить — тоже здесь. Правила чата — коротко, на «ты», без родовых окончаний и политики — бот добавляет сам."
              >
                <Field>
                  <FieldLabel htmlFor="sveta-persona">Характер</FieldLabel>
                  <Textarea
                    id="sveta-persona"
                    rows={10}
                    maxLength={PERSONA_MAX}
                    value={draft.sveta.persona}
                    onChange={(event) => set({ persona: event.target.value })}
                  />
                  <FieldDescription>
                    {draft.sveta.persona.length} / {PERSONA_MAX}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Как она отвечает — примеры</FieldLabel>
                  <FieldDescription>
                    Пара «что написал игрок — что ответила Света». Модель берёт из них тон и манеру, но не повторяет дословно. Пиши ответы
                    без «записался / пришла» об игроках — Света не знает их пол.
                  </FieldDescription>
                  <ExamplesEditor examples={draft.sveta.examples} onChange={(examples) => set({ examples })} />
                </Field>
                {status && (status.defaultPersona !== draft.sveta.persona || !same(status.defaultExamples, draft.sveta.examples)) && (
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="outline" className="w-fit" />}>
                      <RotateCcw /> Характер по умолчанию
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Вернуть характер по умолчанию?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Характер и примеры реплик заменятся на те, что идут с ботом. Твой текст пропадёт, когда нажмёшь «Сохранить», — до
                          этого изменения можно отменить.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={() => set({ persona: status.defaultPersona, examples: status.defaultExamples })}>
                          Заменить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </SectionCard>
            </TabsContent>
            <TabsContent value="model" className="flex flex-col gap-6">
              <SectionCard
                title="Модель и потолки"
                description="Один ответ — обычно один запрос к модели. Потолки берегут бесплатные лимиты Google и OpenRouter."
              >
                <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="sveta-new-model">Модели</FieldLabel>
                    <ModelsEditor
                      models={draft.sveta.models}
                      inUse={[draft.sveta.model, draft.sveta.fallbackModel]}
                      onChange={(models) => set({ models })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sveta-model">Основная модель</FieldLabel>
                    <Select
                      items={Object.fromEntries(draft.sveta.models.map((model) => [model, model]))}
                      value={draft.sveta.model}
                      onValueChange={(model: string | null) => model && set({ model })}
                    >
                      <SelectTrigger id="sveta-model" className="w-full font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {draft.sveta.models.map((model) => (
                          <SelectItem key={model} value={model} className="font-mono text-xs">
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sveta-fallback">Запасная модель</FieldLabel>
                    <Select
                      items={{ [NO_FALLBACK]: 'Без запасной', ...Object.fromEntries(draft.sveta.models.map((model) => [model, model])) }}
                      value={draft.sveta.fallbackModel || NO_FALLBACK}
                      onValueChange={(model: string | null) => model && set({ fallbackModel: model === NO_FALLBACK ? '' : model })}
                    >
                      <SelectTrigger id="sveta-fallback" className="w-full font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_FALLBACK}>Без запасной</SelectItem>
                        {draft.sveta.models.map((model) => (
                          <SelectItem key={model} value={model} className="font-mono text-xs">
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <FieldDescription className="md:col-span-2">
                    Запасная отвечает, когда основная перегружена, не отвечает или упёрлась в лимит. Gemini (ключ {code('GEMINI_API_KEY')}):{' '}
                    {code('gemini-flash-latest')} — умнее, {code('gemini-flash-lite-latest')} — больше запросов в день. OpenRouter (ключ{' '}
                    {code('OPENROUTER_API_KEY')}) — имя с «/», например {code('minimax/minimax-m3.1-flash')}; у бесплатных (с{' '}
                    {code(':free')} на конце) общий дневной лимит на аккаунт.
                  </FieldDescription>
                  <Field>
                    <FieldLabel htmlFor="sveta-thinking">Обдумывание</FieldLabel>
                    <Select
                      items={THINKING}
                      value={draft.sveta.thinking}
                      onValueChange={(thinking: Thinking | null) => thinking && set({ thinking })}
                    >
                      <SelectTrigger id="sveta-thinking" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(THINKING) as Thinking[]).map((level) => (
                          <SelectItem key={level} value={level}>
                            {THINKING[level]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Сколько модель думает перед ответом. Выше — продуманнее, но медленнее, а «мысли» оплачиваются как ответ: сколько стоит
                      — видно в «Расходе по моделям».
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

              <UsageCard perDay={draft.sveta.perDay} />
            </TabsContent>
            <TabsContent value="lore">
              <LoreEditor lore={draft.sveta.lore} onChange={(lore) => set({ lore })} />
            </TabsContent>
            <TabsContent value="memory">
              <MemoryCard />
            </TabsContent>
          </Tabs>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
