import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, CopyPlus, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Option, RaidTemplate, TemplateCreateResponse } from '@api';
import { ChannelPicker, MentionPicker } from '@/components/entity-picker';
import { PageHeader } from '@/components/page';
import { FormErrors, FormSkeleton, ListEmpty, NumberField, SaveBar, SectionCard, TimeInput, TokenTextarea } from '@/components/settings-ui';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/api';
import { formatDay, todayInKyiv } from '@/lib/format';
import { useOptions, useSettings } from '@/lib/queries';
import { useSectionForm } from '@/lib/settings-form';

const MAX_TEMPLATES = 25;
const nameOf = (list: Option[] | undefined, id: string | null) => (id ? (list?.find((o) => o.id === id)?.name ?? 'удалён') : null);

/** Карточка «создать регу по шаблону»: дата, время и подтверждение. */
function CreateCard({ template }: { template: RaidTemplate }) {
  const { data: options } = useOptions();
  const today = todayInKyiv();
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(template.time);
  const [confirm, setConfirm] = useState(false);
  const channel = nameOf(options?.textChannels, template.channelId);
  const ping = nameOf(options?.mentionRoles, template.pingRoleId);

  const mutation = useMutation({
    mutationFn: () => api.post<TemplateCreateResponse>(`/templates/${template.id}/create`, { date, time }),
    onSuccess: (result) =>
      toast.success(result.message, { action: { label: 'Открыть', onClick: () => window.open(result.url, '_blank', 'noopener') } }),
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{template.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">
            <Users /> {template.size} мест
          </Badge>
          {channel && <Badge variant="outline">{channel}</Badge>}
          {ping && <Badge variant="outline">@{ping}</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[1fr_auto] gap-2">
        <Input type="date" aria-label="Дата" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input type="time" aria-label="Время" className="w-28" value={time} onChange={(e) => setTime(e.target.value)} />
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!date || mutation.isPending} onClick={() => setConfirm(true)}>
          {mutation.isPending ? <Spinner /> : <CalendarPlus />} Создать регу
        </Button>
      </CardFooter>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Опубликовать регу?</AlertDialogTitle>
            <AlertDialogDescription>
              «{template.title}» на {date ? formatDay(date) : '—'} в {time} — в {channel ?? 'канал шаблона'}
              {ping ? ` с упоминанием @${ping}` : ''}. Рега сразу появится в Discord.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                mutation.mutate();
              }}
            >
              Опубликовать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TemplateEditor({
  template,
  index,
  set,
  remove,
}: {
  template: RaidTemplate;
  index: number;
  set: (change: Partial<RaidTemplate>) => void;
  remove: () => void;
}) {
  const id = (name: string) => `t${index}-${name}`;
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <CopyPlus className="size-4" />
        </div>
        <div className="min-w-0 flex-1 truncate font-medium">{template.title || 'Новый шаблон'}</div>
        {!template.id && <Badge variant="secondary">не сохранён</Badge>}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          aria-label="Удалить шаблон"
          onClick={remove}
        >
          <Trash2 />
        </Button>
      </div>
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={id('title')}>Название</FieldLabel>
          <Input id={id('title')} maxLength={100} value={template.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('channel')}>Канал</FieldLabel>
          <ChannelPicker id={id('channel')} required value={template.channelId} onChange={(channelId) => set({ channelId })} />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={id('description')}>Описание</FieldLabel>
          <TokenTextarea
            id={id('description')}
            rows={3}
            max={1000}
            value={template.description}
            onChange={(description) => set({ description })}
          />
          <FieldDescription>Сбор, требования — можно оставить пустым.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={id('size')}>Мест в составе</FieldLabel>
          <NumberField id={id('size')} min={1} max={100} value={template.size} onChange={(size) => set({ size })} />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('time')}>Время начала</FieldLabel>
          <TimeInput id={id('time')} value={template.time} onChange={(e) => set({ time: e.target.value })} />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={id('ping')}>Упомянуть роль</FieldLabel>
          <MentionPicker id={id('ping')} emptyLabel="Никого" value={template.pingRoleId} onChange={(pingRoleId) => set({ pingRoleId })} />
        </Field>
      </FieldGroup>
    </div>
  );
}

export function TemplatesPage() {
  const { data: settings } = useSettings();
  const form = useSectionForm('templates', (s) => ({ raidTemplates: s.raidTemplates }));
  const { draft, update } = form;
  const saved = settings?.raidTemplates ?? [];
  const setList = (raidTemplates: RaidTemplate[]) => update(() => ({ raidTemplates }));

  return (
    <>
      <PageHeader
        title="Шаблоны рег"
        description="Заготовки для типовых рейдов: выбери дату — и рега готова, без ввода названия и описания каждый раз."
      />
      {!draft || !settings ? (
        <FormSkeleton />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Создать регу</h2>
            {saved.length === 0 ? (
              <ListEmpty>Шаблонов пока нет — добавь первый ниже.</ListEmpty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {saved.map((template) => (
                  <CreateCard key={template.id} template={template} />
                ))}
              </div>
            )}
          </section>

          <FormErrors errors={form.errors} />
          <SectionCard
            title="Редактировать шаблоны"
            description={`До ${MAX_TEMPLATES} шаблонов. Рега создаётся по сохранённому варианту.`}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={draft.raidTemplates.length >= MAX_TEMPLATES}
                onClick={() =>
                  setList([
                    ...draft.raidTemplates,
                    {
                      id: '',
                      title: '',
                      description: '',
                      size: settings.raids.defaultSize,
                      time: settings.raids.defaultTime,
                      channelId: null,
                      pingRoleId: null,
                    },
                  ])
                }
              >
                <Plus /> Добавить
              </Button>
            }
          >
            {draft.raidTemplates.length === 0 ? (
              <ListEmpty>Нажми «Добавить», чтобы сделать первый шаблон.</ListEmpty>
            ) : (
              draft.raidTemplates.map((template, i) => (
                <TemplateEditor
                  key={template.id || `new-${i}`}
                  index={i}
                  template={template}
                  set={(change) => setList(draft.raidTemplates.map((t, j) => (j === i ? { ...t, ...change } : t)))}
                  remove={() => setList(draft.raidTemplates.filter((_, j) => j !== i))}
                />
              ))
            )}
          </SectionCard>
          <SaveBar form={form} />
        </>
      )}
    </>
  );
}
