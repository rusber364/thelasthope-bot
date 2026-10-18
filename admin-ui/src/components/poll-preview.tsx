// Как бот понял опрос: страницы, условия показа, вопросы и варианты.
import { CircleCheck, Clock, EyeOff, FileText, GitBranch, ListChecks, MousePointerClick, UserRound } from 'lucide-react';
import type { PollDefinition, QuestionKind } from '@api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const KIND_LABELS: Record<QuestionKind, string> = {
  single: 'один вариант',
  multiple: 'несколько вариантов',
  short: 'короткий ответ',
  paragraph: 'длинный ответ',
  image: 'картинка',
};

export function PollPreview({ poll, minutes, questions }: { poll: PollDefinition; minutes: number | null; questions: number | null }) {
  const all = poll.blocks.flatMap((block) => block.questions);
  const condition = (questionId: string, value: string, negate: boolean) => {
    const question = all.find((q) => q.id === questionId);
    const option = question?.options.find((o) => o.value === value);
    return `«${question?.title ?? questionId}» ${negate ? '≠' : '='} «${option?.label ?? value}»`;
  };

  return (
    <div className="flex flex-col gap-3">
      <Card size="sm">
        {poll.image && /^https?:\/\//.test(poll.image) && <img src={poll.image} alt="" className="max-h-48 w-full object-cover" />}
        <CardHeader>
          <CardTitle className="text-lg">{poll.title}</CardTitle>
          {poll.description && <CardDescription className="whitespace-pre-wrap">{poll.description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">
            <MousePointerClick /> «{poll.button}»
          </Badge>
          <Badge variant="secondary">
            <FileText /> страниц: {poll.blocks.length}
          </Badge>
          {questions !== null && (
            <Badge variant="secondary">
              <ListChecks /> вопросов: {questions}
            </Badge>
          )}
          {minutes !== null && (
            <Badge variant="secondary">
              <Clock /> ~{minutes} мин
            </Badge>
          )}
          <Badge variant="outline">
            {poll.anonymous ? (
              <>
                <EyeOff /> анонимный
              </>
            ) : (
              <>
                <UserRound /> с именами
              </>
            )}
          </Badge>
        </CardContent>
      </Card>

      {poll.blocks.map((block, index) => (
        <Card key={index} size="sm">
          <CardHeader>
            <CardTitle>
              <span className="text-muted-foreground">Страница {index + 1}.</span> {block.title}
            </CardTitle>
            {block.conditions.length > 0 && (
              <CardDescription className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                <GitBranch className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Показывается, только если {block.conditions.map((c) => condition(c.questionId, c.optionValue, c.negate)).join(' и ')}
                </span>
              </CardDescription>
            )}
            {block.intro && <CardDescription className="whitespace-pre-wrap">{block.intro}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-3 pl-5 marker:text-muted-foreground">
              {block.questions.map((q) => (
                <li key={q.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{q.title}</span>
                    {q.required && <span className="text-destructive">*</span>}
                    <Badge variant="outline" className="text-muted-foreground">
                      {KIND_LABELS[q.kind]}
                    </Badge>
                  </div>
                  {q.hint && <div className="text-xs text-muted-foreground">{q.hint}</div>}
                  {q.options.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      {q.options.map((o) => (
                        <li key={o.value} className="flex gap-2">
                          <span className="text-muted-foreground">{q.kind === 'multiple' ? '☐' : '○'}</span>
                          <span>
                            {o.label}
                            {o.description && <span className="text-muted-foreground"> — {o.description}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}

      {poll.finish && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" /> После опроса
            </CardTitle>
            <CardDescription className="whitespace-pre-wrap">{poll.finish}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
