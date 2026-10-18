// Поле для текста опроса: моноширинный шрифт, номера строк, подсветка строк с ошибками, переход к строке.
import { useImperativeHandle, useRef, type Ref } from 'react';
import { cn } from '@/lib/utils';

export interface CodeEditorHandle {
  /** Выделить строку (с 1) и прокрутить к ней. */
  goToLine: (line: number) => void;
}

const LINE_HEIGHT = 20;

export function CodeEditor({
  value,
  onChange,
  errorLines = new Set<number>(),
  ref,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  errorLines?: Set<number>;
  ref?: Ref<CodeEditorHandle>;
  id?: string;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;

  useImperativeHandle(ref, () => ({
    goToLine(line) {
      const el = area.current;
      if (!el) return;
      const all = el.value.split('\n');
      let start = 0;
      for (let i = 0; i < line - 1 && i < all.length; i++) start += all[i]!.length + 1;
      el.focus();
      el.setSelectionRange(start, start + (all[line - 1] ?? '').length);
      el.scrollTop = Math.max(0, line - 5) * LINE_HEIGHT;
    },
  }));

  return (
    <div className="flex h-[32rem] overflow-hidden rounded-lg border border-input bg-muted/30 font-mono text-[13px] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/20">
      <div
        ref={gutter}
        aria-hidden
        className="shrink-0 overflow-hidden border-r bg-muted/50 py-2 text-right text-muted-foreground/70 select-none"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
            className={cn('px-2 tabular-nums', errorLines.has(i + 1) && 'bg-destructive/15 font-semibold text-destructive')}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        id={id}
        ref={area}
        value={value}
        spellCheck={false}
        wrap="off"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        style={{ lineHeight: `${LINE_HEIGHT}px` }}
        className="flex-1 resize-none overflow-auto bg-transparent px-3 py-2 whitespace-pre outline-none"
      />
    </div>
  );
}
