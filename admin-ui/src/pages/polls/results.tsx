import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Hourglass,
  Lock,
  Search,
  Settings2,
  Users,
} from 'lucide-react';
import type { Settings } from '@api';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import type { PollResultsResponse, PollRespondent, PollStats } from '@api';
import { PageHeader } from '@/components/page';
import { ListEmpty } from '@/components/settings-ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, errorText } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { formatDateTime } from '@/lib/format';
import { NotFoundPage } from '@/pages/not-found';

const SHOWN_TEXTS = 100;
const SHOWN_IMAGES = 60;

/** Картинка-ответ: превью, по клику — полный размер в новой вкладке. */
function AnswerImage({ pollId, fileId, caption }: { pollId: number; fileId: number; caption?: string }) {
  const url = `/api/polls/${pollId}/files/${fileId}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-col gap-1">
      <img
        src={url}
        alt={caption ?? 'картинка'}
        loading="lazy"
        className="aspect-video w-full rounded-lg border bg-muted object-cover hover:opacity-90"
      />
      {caption && <span className="truncate text-xs text-muted-foreground">{caption}</span>}
    </a>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-primary">
          {icon} {label}
        </CardDescription>
        <div className="font-heading text-3xl font-semibold tabular-nums">{value}</div>
      </CardHeader>
    </Card>
  );
}

function QuestionStats({
  pollId,
  question,
  names,
}: {
  pollId: number;
  question: PollStats['questions'][number];
  names: Record<string, string>;
}) {
  const texts = question.kind === 'short' || question.kind === 'paragraph';
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {question.title}
          {question.required && <span className="text-destructive">*</span>}
        </CardTitle>
        <CardDescription>Ответили: {question.answered}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {question.options.map((option) => (
          <div key={option.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="text-sm">{option.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {option.percent}% · {option.count}
            </span>
            <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${option.percent}%` }} />
            </div>
          </div>
        ))}
        {texts &&
          (question.texts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ответов пока нет.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border text-sm">
              {question.texts.slice(0, SHOWN_TEXTS).map((answer, i) => (
                <li key={i} className="px-3 py-2 whitespace-pre-wrap">
                  {answer.userId && <span className="font-medium">{names[answer.userId] ?? 'ушёл с сервера'}: </span>}
                  {answer.text}
                </li>
              ))}
              {question.texts.length > SHOWN_TEXTS && (
                <li className="px-3 py-2 text-muted-foreground">…ещё {question.texts.length - SHOWN_TEXTS} — в таблице для Excel.</li>
              )}
            </ul>
          ))}
        {question.kind === 'image' &&
          (question.images.length === 0 ? (
            <p className="text-sm text-muted-foreground">Картинок пока нет.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {question.images.slice(0, SHOWN_IMAGES).map((image) => (
                <AnswerImage
                  key={image.fileId}
                  pollId={pollId}
                  fileId={image.fileId}
                  caption={image.userId ? (names[image.userId] ?? 'ушёл с сервера') : undefined}
                />
              ))}
              {question.images.length > SHOWN_IMAGES && (
                <p className="col-span-full text-sm text-muted-foreground">
                  …ещё {question.images.length - SHOWN_IMAGES} — по участникам или ссылками в таблице для Excel.
                </p>
              )}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function Respondent({ pollId, person, open }: { pollId: number; person: PollRespondent; open: boolean }) {
  return (
    <details open={open} className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
        {person.completed ? <Badge className="bg-success/15 text-success">пройден</Badge> : <Badge variant="secondary">не закончен</Badge>}
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatDateTime(person.updatedAt)}</span>
      </summary>
      <div className="border-t px-4 py-3">
        {person.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ответов на вопросы пока нет.</p>
        ) : (
          <dl className="flex flex-col gap-2 text-sm">
            {person.answers.map((answer, i) => (
              <div key={i}>
                {(i === 0 || person.answers[i - 1]!.block !== answer.block) && (
                  <div className="mt-2 mb-1 text-xs font-medium tracking-wide text-primary uppercase first:mt-0">{answer.block}</div>
                )}
                <dt className="text-muted-foreground">{answer.question}</dt>
                <dd className="whitespace-pre-wrap">
                  {answer.image === undefined ? (
                    answer.answer
                  ) : (
                    <div className="mt-1 max-w-xs">
                      <AnswerImage pollId={pollId} fileId={answer.image} />
                    </div>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

export function PollResultsPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  // «Сделать анкетой новичков»: этот опрос — в приветствие, остальные настройки анкеты не меняются.
  const makeOnboarding = useMutation({
    mutationFn: () => api.put<Settings>('/settings/onboarding', { onboarding: { ...settings!.onboarding, pollId: Number(id) } }),
    onSuccess: (next) => {
      queryClient.setQueryData(['settings'], next);
      toast.success('Теперь новичкам в приветствии предлагается эта анкета.');
      void queryClient.invalidateQueries({ queryKey: ['poll', id] });
      void queryClient.invalidateQueries({ queryKey: ['polls'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const [search, setSearch] = useState('');
  const { data, error } = useQuery({ queryKey: ['poll', id], queryFn: () => api.get<PollResultsResponse>(`/polls/${id}`) });

  const close = useMutation({
    mutationFn: () => api.post(`/polls/${id}/close`),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ['poll', id] });
      void queryClient.invalidateQueries({ queryKey: ['polls'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (error) return <NotFoundPage />;
  if (!data) return <Skeleton className="h-96 w-full rounded-xl" />;

  const { info, stats, names, respondents } = data;
  const people = (respondents ?? []).filter((person) => person.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/polls" />} nativeButton={false} className="-ml-2 text-muted-foreground">
          <ArrowLeft /> Все опросы
        </Button>
      </div>
      <PageHeader
        title={info.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            Опрос #{info.id} · {info.channel}
            {info.closed ? <Badge variant="secondary">закрыт</Badge> : <Badge className="bg-success/15 text-success">открыт</Badge>}
            <Badge variant="outline">{info.anonymous ? 'анонимный' : 'с именами'}</Badge>
            {info.onboarding && (
              <Badge variant="outline" className="border-primary/40 text-primary">
                анкета новичков
              </Badge>
            )}
            {info.url && (
              <a href={info.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                открыть в Discord <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="outline" render={<a href={`/api/polls/${info.id}/csv`} download />} nativeButton={false}>
              <Download /> Таблица для Excel
            </Button>
            {info.onboarding ? (
              <Button variant="outline" render={<Link to="/welcome?tab=onboarding" />} nativeButton={false}>
                <Settings2 /> Настроить анкету
              </Button>
            ) : (
              !info.closed && (
                <Button variant="outline" disabled={!settings || makeOnboarding.isPending} onClick={() => makeOnboarding.mutate()}>
                  {makeOnboarding.isPending ? <Spinner /> : <ClipboardList />} Сделать анкетой новичков
                </Button>
              )
            )}
            {info.canCopy && (
              <Button variant="outline" render={<Link to={`/polls/new?from=${info.id}`} />} nativeButton={false}>
                <Copy /> Создать копию
              </Button>
            )}
            {!info.closed && (
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="destructive" disabled={close.isPending} />}>
                  {close.isPending ? <Spinner /> : <Lock />} Закрыть
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Закрыть опрос?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Новые ответы перестанут приниматься, кнопка в Discord станет неактивной. Итоги останутся.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => close.mutate()}>
                      Закрыть опрос
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<CheckCheck />} label="Завершили" value={stats.completed} />
        <Stat icon={<Hourglass />} label="Начали, но не закончили" value={stats.total - stats.completed} />
        <Stat icon={<Users />} label="Всего начали" value={stats.total} />
      </div>

      <Tabs defaultValue="stats" className="gap-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="stats">
            <BarChart3 /> Статистика
          </TabsTrigger>
          <TabsTrigger value="people">
            <Users /> По участникам ({stats.total})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stats" className="flex flex-col gap-3">
          {stats.questions.length === 0 && <ListEmpty>Вопросов нет.</ListEmpty>}
          {stats.questions.map((question, i) => (
            <div key={i} className="flex flex-col gap-3">
              {(i === 0 || stats.questions[i - 1]!.block !== question.block) && (
                <h2 className="mt-2 text-sm font-medium text-muted-foreground first:mt-0">{question.block}</h2>
              )}
              <QuestionStats pollId={info.id} question={question} names={names} />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="people" className="flex flex-col gap-3">
          {respondents === null ? (
            <Alert>
              <Users />
              <AlertDescription>
                Опрос анонимный — ответы по участникам не показываются. Общая статистика — на соседней вкладке.
              </AlertDescription>
            </Alert>
          ) : respondents.length === 0 ? (
            <ListEmpty>Ответов пока нет.</ListEmpty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Найти участника" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <span className="text-xs text-muted-foreground">Сначала те, кто дошёл до конца, внутри — свежие сверху.</span>
              </div>
              {people.length === 0 ? (
                <ListEmpty>Никого не нашлось.</ListEmpty>
              ) : (
                people.map((person, i) => (
                  <Respondent key={`${person.name}-${i}`} pollId={info.id} person={person} open={i < 3 && !search} />
                ))
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
