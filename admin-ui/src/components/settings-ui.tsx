// Общие части страниц настроек: карточка раздела, панель сохранения, ошибки, числовое поле, текст с подстановками.
import { CircleAlert, RotateCcw, Save } from 'lucide-react';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SectionForm } from '@/lib/settings-form';
import { cn } from '@/lib/utils';

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

/** Скелет страницы настроек, пока они загружаются. */
export function FormSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} className="h-48 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Ошибки последнего сохранения. */
export function FormErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>Не сохранено</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/** Панель внизу экрана: появляется, когда есть несохранённые изменения. */
export function SaveBar({ form, extra }: { form: Pick<SectionForm<never>, 'dirty' | 'saving' | 'save' | 'reset'>; extra?: ReactNode }) {
  return (
    <div
      className={cn(
        'sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-popover/95 p-2 pl-4 shadow-lg backdrop-blur transition-all',
        form.dirty || form.saving ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <span className="mr-auto text-sm text-muted-foreground">Есть несохранённые изменения</span>
      {extra}
      <Button variant="ghost" onClick={form.reset} disabled={form.saving}>
        <RotateCcw /> Отменить
      </Button>
      <Button onClick={form.save} disabled={form.saving}>
        {form.saving ? <Spinner /> : <Save />} Сохранить
      </Button>
    </div>
  );
}

/** Целое число: пока поле пустое или неверное, наружу ничего не уходит; при уходе из поля показывается текущее значение. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  id,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  id?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className="w-28"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isInteger(next)) {
            setShown(next);
            onChange(next);
          }
        }}
        onBlur={() => setText(String(value))}
      />
      {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** Время ЧЧ:ММ: узкое поле, а не на всю ширину (Field растягивает прямых потомков). */
export function TimeInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  return (
    <div>
      <Input type="time" className={cn('w-32', className)} {...props} />
    </div>
  );
}

export interface Token {
  token: string;
  hint: string;
}

/** Текст для Discord: кнопки-подстановки вставляют {…} в место курсора, внизу — счётчик символов. */
export function TokenTextarea({
  value,
  onChange,
  tokens = [],
  max,
  rows = 4,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  tokens?: Token[];
  max: number;
  rows?: number;
  id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const area = ref.current;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-0 resize-y"
      />
      <div className="flex flex-wrap items-center gap-1">
        {tokens.map(({ token, hint }) => (
          <Tooltip key={token}>
            <TooltipTrigger
              render={<Button type="button" variant="secondary" size="xs" className="font-mono" onClick={() => insert(token)} />}
            >
              {token}
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ))}
        <span className={cn('ml-auto text-xs tabular-nums', value.length > max ? 'text-destructive' : 'text-muted-foreground')}>
          {value.length} / {max}
        </span>
      </div>
    </div>
  );
}

/** Строка «нет элементов» внутри карточки со списком. */
export function ListEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;
}
