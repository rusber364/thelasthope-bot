// Предпросмотр сообщения бота «как в Discord»: подстановки {…} заменяются примерами, работает **жирный**, *курсив*, __подчёркнутый__.
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useOverview } from '@/lib/queries';

export interface PreviewValue {
  text: string;
  /** Упоминание (@, #) — подсвечивается как в Discord. */
  mention?: boolean;
}

const MARKUP = /(\{\w+\}|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|`[^`\n]+`)/g;

function Mention({ children }: { children: ReactNode }) {
  return <span className="rounded-sm bg-[#5865f2]/25 px-0.5 font-medium text-[#3b46d6] dark:text-[#c9cdfb]">{children}</span>;
}

/** Разметка Discord → React: без HTML-вставок, только известные куски. */
function renderText(text: string, values: Record<string, PreviewValue>): ReactNode[] {
  return text.split(MARKUP).map((part, i) => {
    const token = /^\{(\w+)\}$/.exec(part)?.[1];
    if (token) {
      const value = values[token];
      if (!value) return part;
      return value.mention ? <Mention key={i}>{value.text}</Mention> : value.text;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{renderText(part.slice(2, -2), values)}</strong>;
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) return <u key={i}>{renderText(part.slice(2, -2), values)}</u>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{renderText(part.slice(1, -1), values)}</em>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={i} className="rounded bg-black/10 px-1 text-[0.85em] dark:bg-black/30">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

export interface PreviewButton {
  label: string;
  emoji: string;
  /** success — зелёная кнопка, link — серая кнопка-ссылка. */
  style: 'success' | 'link';
}

/** Одно сообщение бота. card — сообщение-карточка с цветной полосой слева (как приветствие в канале). */
export function DiscordPreview({
  parts,
  values,
  buttons = [],
  card = false,
}: {
  parts: string[];
  values: Record<string, PreviewValue>;
  buttons?: PreviewButton[];
  card?: boolean;
}) {
  const { data } = useOverview();
  const name = data?.bot.split('#')[0] ?? 'Бот';
  return (
    <div className="rounded-lg border bg-[#f2f3f5] p-4 text-[0.9375rem] text-[#313338] dark:bg-[#313338] dark:text-[#dbdee1]">
      <div className="flex gap-3">
        <Avatar className="size-10">
          {data && <AvatarImage src={data.avatarUrl} alt="" />}
          <AvatarFallback>TLH</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[#060607] dark:text-white">{name}</span>
            <span className="rounded bg-[#5865f2] px-1 text-[0.625rem] leading-4 font-semibold text-white">БОТ</span>
            <span className="text-xs text-[#5c5e66] dark:text-[#949ba4]">Сегодня в 20:00</span>
          </div>
          <div
            className={
              card
                ? 'mt-1 flex flex-col gap-3 rounded-lg border-l-4 border-l-[#57f287] bg-white p-4 dark:bg-[#2b2d31]'
                : 'flex flex-col gap-2'
            }
          >
            {parts
              .filter((part) => part.trim())
              .map((part, i) => (
                <div key={i} className="break-words whitespace-pre-wrap">
                  {renderText(part, values)}
                </div>
              ))}
            {buttons.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {buttons.map((button, i) => (
                  <span
                    key={i}
                    className={
                      button.style === 'success'
                        ? 'rounded-lg bg-[#248046] px-3 py-1.5 text-sm font-medium text-white'
                        : 'rounded-lg bg-[#6d6f78] px-3 py-1.5 text-sm font-medium text-white dark:bg-[#4e5058]'
                    }
                  >
                    {button.emoji} {renderText(button.label, values)}
                    {button.style === 'link' && <span className="ml-1 opacity-70">↗</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
