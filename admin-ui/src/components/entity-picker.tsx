// Выбор канала, роли или участника: кнопка с текущим значением, список с поиском, каналы сгруппированы по категориям.
import { Hash, TriangleAlert, UserRound, Volume2 } from 'lucide-react';
import type { Option } from '@api';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers, useOptions } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Kind = 'channel' | 'voice' | 'role' | 'mention' | 'member';

/** Пункт «не выбрано» — первый в списке, у него пустой id. */
const NONE_ID = '';

function OptionIcon({ kind, option }: { kind: Kind; option: Option }) {
  if (option.id === NONE_ID) return <span className="size-4" />;
  if (kind === 'channel') return <Hash className="text-muted-foreground" />;
  if (kind === 'voice') return <Volume2 className="text-muted-foreground" />;
  if (kind === 'member') return <UserRound className="text-muted-foreground" />;
  return (
    <span
      className="mx-1 size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
      style={option.color ? { backgroundColor: option.color } : undefined}
    />
  );
}

/** Каналы приходят с префиксом «#» или «🔊» — рядом и так стоит значок. */
const displayName = (option: Option) => option.name.replace(/^(#|🔊 )/, '');

interface PickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Подпись пустого значения: «— не выбрано —», «— никого —»… */
  emptyLabel?: string;
  /** Нельзя оставить пустым (например, канал липкого сообщения). */
  required?: boolean;
  invalid?: boolean;
  id?: string;
}

function EntityPicker({
  kind,
  options,
  value,
  onChange,
  emptyLabel = 'Не выбрано',
  required,
  invalid,
  id,
}: PickerProps & { kind: Kind; options: Option[] }) {
  const none: Option = { id: NONE_ID, name: emptyLabel };
  // Выбранный канал могли удалить на сервере — показываем это, а не пустое поле.
  const missing: Option | null =
    value && !options.some((o) => o.id === value)
      ? { id: value, name: 'Удалён с сервера', warning: 'Этого канала или роли больше нет на сервере — выбери другой.' }
      : null;
  const all = [...(required ? [] : [none]), ...(missing ? [missing] : []), ...options];

  const groups: { value: string; items: Option[] }[] = [];
  for (const option of all) {
    const name = option.group ?? '';
    const group = groups.find((g) => g.value === name) ?? groups[groups.push({ value: name, items: [] }) - 1]!;
    group.items.push(option);
  }

  const selected = all.find((o) => o.id === (value ?? NONE_ID)) ?? null;
  const warning = selected?.warning;

  return (
    <div className="flex flex-col gap-1.5">
      <Combobox
        items={groups}
        value={selected}
        onValueChange={(option: Option | null) => onChange(option && option.id !== NONE_ID ? option.id : null)}
        itemToStringLabel={(option: Option) => displayName(option)}
        isItemEqualToValue={(a: Option, b: Option) => a.id === b.id}
        autoHighlight
      >
        <ComboboxTrigger
          id={id}
          aria-invalid={invalid || Boolean(missing) || undefined}
          render={<Button variant="outline" className="w-full justify-between gap-2 px-2.5 font-normal" />}
        >
          <span className={cn('flex min-w-0 items-center gap-1.5', (!selected || selected.id === NONE_ID) && 'text-muted-foreground')}>
            {selected ? (
              <>
                {selected.id !== NONE_ID && <OptionIcon kind={kind} option={selected} />}
                <span className="truncate">{displayName(selected)}</span>
              </>
            ) : (
              <span className="truncate">{required ? 'Выбери…' : emptyLabel}</span>
            )}
          </span>
        </ComboboxTrigger>
        <ComboboxContent className="min-w-64">
          <ComboboxInput showTrigger={false} placeholder="Поиск…" />
          <ComboboxEmpty>Ничего не найдено</ComboboxEmpty>
          <ComboboxList>
            {(group: { value: string; items: Option[] }) => (
              <ComboboxGroup key={group.value || '_'} items={group.items}>
                {group.value && <ComboboxLabel>{group.value}</ComboboxLabel>}
                <ComboboxCollection>
                  {(option: Option) => (
                    <ComboboxItem key={option.id || '_none'} value={option}>
                      <OptionIcon kind={kind} option={option} />
                      <span className={cn('truncate', option.id === NONE_ID && 'text-muted-foreground')}>{displayName(option)}</span>
                      {option.warning && option.id !== NONE_ID && <TriangleAlert className="ml-auto text-amber-500" />}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {warning && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-px size-3.5 shrink-0" /> {warning}
        </p>
      )}
    </div>
  );
}

function makePicker(pick: (options: NonNullable<ReturnType<typeof useOptions>['data']>) => Option[], kind: Kind) {
  return function Picker(props: PickerProps) {
    const { data } = useOptions();
    if (!data) return <Skeleton className="h-8 w-full" />;
    return <EntityPicker kind={kind} options={pick(data)} {...props} />;
  };
}

/** Текстовый канал сервера. */
export const ChannelPicker = makePicker((o) => o.textChannels, 'channel');
/** Голосовой канал сервера. */
export const VoicePicker = makePicker((o) => o.voiceChannels, 'voice');
/** Роль, которую бот выдаёт: с предупреждением, если она выше роли бота. */
export const RolePicker = makePicker((o) => o.roles, 'role');
/** Роль для упоминания: высота роли неважна. */
export const MentionPicker = makePicker((o) => o.mentionRoles, 'mention');

interface MultiPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Сколько можно выбрать. */
  max: number;
  id?: string;
  /** Подсказка, когда ничего не выбрано. */
  placeholder?: string;
  disabled?: boolean;
}

/** Несколько ролей для упоминания: метки с цветом роли, список с поиском и предупреждение, если роль не пингуется. */
export function MentionRolesPicker(props: MultiPickerProps) {
  const { data } = useOptions();
  return <MultiPicker {...props} kind="mention" options={data?.mentionRoles} />;
}

/** Несколько ролей, без предупреждений про упоминание и выдачу, — например, кто может записаться на регу. */
export function AccessRolesPicker(props: MultiPickerProps) {
  const { data } = useOptions();
  return <MultiPicker {...props} kind="mention" options={data?.roles.map((role) => ({ ...role, warning: undefined }))} />;
}

/** Несколько текстовых каналов — например, где живёт Света. */
export function ChannelsPicker(props: MultiPickerProps) {
  const { data } = useOptions();
  return <MultiPicker placeholder="Ни одного — выбери каналы" {...props} kind="channel" options={data?.textChannels} />;
}

/** Несколько участников сервера (без ботов) — например, кому разрешён мат. */
export function MembersPicker(props: MultiPickerProps) {
  const { data } = useMembers();
  return <MultiPicker placeholder="Никого — выбери участников" {...props} kind="member" options={data} />;
}

function MultiPicker({
  value,
  onChange,
  max,
  id,
  placeholder = 'Никого — выбери роли',
  disabled,
  kind,
  options,
}: MultiPickerProps & { kind: Kind; options: Option[] | undefined }) {
  const anchor = useComboboxAnchor();
  if (!options) return <Skeleton className="h-8 w-full" />;
  // Роль или канал могли удалить, а участник — уйти с сервера: оставляем метку, чтобы её было видно и можно было убрать.
  const gone = kind === 'member' ? 'нет на сервере' : kind === 'channel' ? 'удалён с сервера' : 'удалена с сервера';
  const selected = value.map((itemId) => options.find((o) => o.id === itemId) ?? { id: itemId, name: gone });
  const silent = selected.filter((role) => role.warning);
  return (
    <div className="flex flex-col gap-1.5">
      <Combobox
        items={options}
        multiple
        value={selected}
        onValueChange={(next: Option[]) => onChange(next.slice(0, max).map((o) => o.id))}
        itemToStringLabel={(option: Option) => displayName(option)}
        isItemEqualToValue={(a: Option, b: Option) => a.id === b.id}
        autoHighlight
        disabled={disabled}
      >
        <ComboboxChips ref={anchor} className={cn(disabled && 'opacity-50')}>
          <ComboboxValue>
            {selected.map((item) => (
              <ComboboxChip key={item.id} className={item.warning ? 'text-amber-700 dark:text-amber-300' : undefined}>
                {item.warning ? <TriangleAlert className="size-3 text-amber-500" /> : <OptionIcon kind={kind} option={item} />}
                {displayName(item)}
              </ComboboxChip>
            ))}
          </ComboboxValue>
          <ComboboxChipsInput id={id} placeholder={selected.length ? '' : placeholder} disabled={disabled || selected.length >= max} />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Ничего не найдено</ComboboxEmpty>
          <ComboboxList>
            {(option: Option) => (
              <ComboboxItem key={option.id} value={option}>
                <OptionIcon kind={kind} option={option} />
                <span className="truncate">{displayName(option)}</span>
                {option.warning && <TriangleAlert className="ml-auto text-amber-500" />}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {silent.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            {silent.map((role) => role.name).join(', ')}: {silent[0]!.warning}
          </span>
        </p>
      )}
    </div>
  );
}
