import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, errorText } from '@/lib/api';

/** Кнопка действия на боте (пробная отправка и т. п.): результат — уведомлением. При несохранённых изменениях — неактивна. */
export function ActionButton({
  path,
  children,
  icon,
  dirty = false,
}: {
  path: string;
  children: ReactNode;
  icon: ReactNode;
  dirty?: boolean;
}) {
  const mutation = useMutation({
    mutationFn: () => api.post(path),
    onSuccess: (result) => toast.success(result.message),
    onError: (error) => toast.error(errorText(error)),
  });
  const button = (
    <Button variant="outline" disabled={dirty || mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending ? <Spinner /> : icon} {children}
    </Button>
  );
  if (!dirty) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>{button}</TooltipTrigger>
      <TooltipContent>Сначала сохрани изменения — бот отправляет сохранённый вариант.</TooltipContent>
    </Tooltip>
  );
}
