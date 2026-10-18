import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, CircleCheck, FileText, ImagePlus, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { PollCheckResponse, PollSourceResponse } from '@api';
import { CodeEditor, type CodeEditorHandle } from '@/components/code-editor';
import { ChannelPicker, MentionPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { PollPreview } from '@/components/poll-preview';
import { SectionCard } from '@/components/settings-ui';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ApiFailure, api, errorText } from '@/lib/api';

const DRAFT_KEY = 'tlh-poll-draft';
const MAX_IMAGE = 8 * 1024 * 1024;

const storage = {
  get: () => {
    try {
      return localStorage.getItem(DRAFT_KEY);
    } catch {
      return null;
    }
  },
  set: (value: string) => {
    try {
      localStorage.setItem(DRAFT_KEY, value);
    } catch {
      // без localStorage черновик просто не запомнится
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // нечего чистить
    }
  },
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const lineOf = (error: string) => Number(/^Строка (\d+)/.exec(error)?.[1] ?? 0);

export function PollEditorPage() {
  const [params] = useSearchParams();
  const copyFrom = params.get('from');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editor = useRef<CodeEditorHandle>(null);

  const [source, setSource] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'publish' | 'template' | null>(null);
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  // Начальный текст: копия опроса, черновик из браузера или шаблон с подсказками.
  const initial = useQuery({
    queryKey: ['poll-source', copyFrom ?? 'draft'],
    queryFn: async (): Promise<PollSourceResponse> => {
      if (copyFrom) return api.get<PollSourceResponse>(`/polls/${copyFrom}/source`);
      const draft = storage.get();
      return draft ? { source: draft, channelId: null, roleId: null } : api.get<PollSourceResponse>('/polls/template');
    },
    staleTime: Infinity,
    gcTime: 0,
  });
  if (initial.data && source === null) {
    setSource(initial.data.source);
    setChannelId(initial.data.channelId);
    setRoleId(initial.data.roleId);
  }

  const edit = (value: string) => {
    setSource(value);
    storage.set(value);
  };

  const debounced = useDebounced(source ?? '', 500);
  const check = useQuery({
    queryKey: ['poll-check', debounced],
    queryFn: () => api.post<PollCheckResponse>('/polls/check', { source: debounced }),
    enabled: debounced.trim().length > 0,
    placeholderData: keepPreviousData,
  });
  const result = check.data;
  const checking = check.isFetching || debounced !== (source ?? '');
  const valid = Boolean(result && !result.errors.length && result.preview);

  const loadTemplate = useMutation({
    mutationFn: () => api.get<PollSourceResponse>('/polls/template'),
    onSuccess: (template) => {
      storage.clear();
      setSource(template.source);
      toast.success('Текст заменён шаблоном.');
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const publish = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.set('source', source ?? '');
      body.set('channel', channelId ?? '');
      body.set('role', roleId ?? '');
      if (image) body.set('image', image);
      return api.post<{ id: number }>('/polls', body);
    },
    onSuccess: ({ id }) => {
      storage.clear();
      void queryClient.invalidateQueries({ queryKey: ['polls'] });
      toast.success('Опрос опубликован.');
      void navigate(`/polls/${id}`);
    },
    onError: (error) => {
      if (error instanceof ApiFailure && error.status === 400) setPublishErrors(error.errors);
      else toast.error(errorText(error));
    },
  });

  if (source === null) {
    return (
      <>
        <PageHeader title="Новый опрос" />
        {initial.isError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{errorText(initial.error)}</AlertDescription>
          </Alert>
        ) : (
          <Skeleton className="h-96 w-full rounded-xl" />
        )}
      </>
    );
  }

  const errorLines = new Set((result?.errors ?? []).map(lineOf).filter(Boolean));

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/polls" />} nativeButton={false} className="-ml-2 text-muted-foreground">
          <ArrowLeft /> Все опросы
        </Button>
      </div>
      <PageHeader
        title={copyFrom ? `Копия опроса #${copyFrom}` : 'Новый опрос'}
        description={
          <>
            <code>#</code> — заголовок, <code>##</code> — страница (до 5 вопросов), <code>###</code> — вопрос (<code>*</code> в конце —
            обязательный), <code>( )</code> — один вариант, <code>[ ]</code> — несколько, <code>Ответ: короткий</code> — ответ текстом,{' '}
            <code>Если: Вопрос = Вариант</code> — страница по условию, <code>//</code> — подсказка. Справа — как бот понял опрос.
          </>
        }
        actions={
          <Button variant="outline" onClick={() => setConfirm('template')} disabled={loadTemplate.isPending}>
            <FileText /> Начать с шаблона
          </Button>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="flex flex-col gap-4">
          <SectionCard
            title="Текст опроса"
            description="Черновик сохраняется в браузере, пока не опубликуешь."
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {checking ? (
                  <>
                    <Spinner className="size-3.5" /> проверка…
                  </>
                ) : valid ? (
                  <>
                    <CircleCheck className="size-3.5 text-success" /> ошибок нет
                  </>
                ) : result?.errors.length ? (
                  <>
                    <CircleAlert className="size-3.5 text-destructive" /> ошибок: {result.errors.length}
                  </>
                ) : null}
              </span>
            }
          >
            <CodeEditor ref={editor} id="poll-source" value={source} onChange={edit} errorLines={errorLines} />
            {result && result.errors.length > 0 && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Ошибки в тексте — нажми, чтобы перейти к строке</AlertTitle>
                <AlertDescription>
                  <ul className="flex flex-col gap-0.5">
                    {result.errors.map((error) => (
                      <li key={error}>
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => lineOf(error) && editor.current?.goToLine(lineOf(error))}
                        >
                          {error}
                        </button>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </SectionCard>

          <SectionCard title="Публикация">
            {publishErrors.length > 0 && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Не опубликовано</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {publishErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="poll-channel">Канал</FieldLabel>
                <ChannelPicker id="poll-channel" required value={channelId} onChange={setChannelId} />
              </Field>
              <Field>
                <FieldLabel htmlFor="poll-role">Упомянуть роль</FieldLabel>
                <MentionPicker id="poll-role" emptyLabel="Никого" value={roleId} onChange={setRoleId} />
              </Field>
            </div>
            <Field>
              <FieldLabel>Картинка</FieldLabel>
              {image && imageUrl ? (
                <div className="flex items-center gap-3 rounded-lg border p-2">
                  <img src={imageUrl} alt="" className="size-12 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{image.name}</div>
                    <div className="text-xs text-muted-foreground">{(image.size / 1024 / 1024).toFixed(1)} МБ</div>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Убрать картинку" onClick={() => setImage(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50">
                  <ImagePlus className="size-4" /> Выбрать файл
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = '';
                      if (file && (!file.type.startsWith('image/') || file.size > MAX_IMAGE))
                        toast.error('Картинка должна быть изображением до 8 МБ.');
                      else setImage(file);
                    }}
                  />
                </label>
              )}
              <FieldDescription>Файл до 8 МБ — или строка «Картинка: ссылка» в тексте.</FieldDescription>
            </Field>
            <Button size="lg" disabled={!valid || !channelId || checking || publish.isPending} onClick={() => setConfirm('publish')}>
              {publish.isPending ? <Spinner /> : <Send />} Опубликовать
            </Button>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-2 xl:sticky xl:top-20">
          <div className="text-sm font-medium text-muted-foreground">Предпросмотр</div>
          {result?.preview ? (
            <PollPreview poll={result.preview} minutes={result.minutes} questions={result.questions} />
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {checking ? 'Проверяю текст…' : 'Исправь ошибки — и здесь появится опрос так, как его понял бот.'}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open: boolean) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'publish' ? 'Опубликовать опрос?' : 'Заменить текст шаблоном?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'publish'
                ? `«${result?.preview?.title ?? ''}» появится в выбранном канале, и участники сразу смогут отвечать.`
                : 'Текущий текст и черновик в браузере пропадут.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === 'template' ? 'destructive' : 'default'}
              onClick={() => {
                if (confirm === 'publish') {
                  setPublishErrors([]);
                  publish.mutate();
                } else loadTemplate.mutate();
                setConfirm(null);
              }}
            >
              {confirm === 'publish' ? 'Опубликовать' : 'Заменить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
