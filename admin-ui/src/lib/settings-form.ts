// Форма одного раздела настроек: черновик, «есть изменения», сохранение через PUT /api/settings/:section.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Settings, SettingsSection, SettingsSections } from '@api';
import { ApiFailure, api, errorText } from './api';
import { useSettings } from './queries';
import { markDirty } from './unsaved';

export interface SectionForm<K extends SettingsSection> {
  /** Черновик; null — настройки ещё загружаются. */
  draft: SettingsSections[K] | null;
  update: (change: (draft: SettingsSections[K]) => SettingsSections[K]) => void;
  dirty: boolean;
  saving: boolean;
  /** Ошибки последнего сохранения — тексты бота, показываются как есть. */
  errors: string[];
  save: () => void;
  reset: () => void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useSectionForm<K extends SettingsSection>(section: K, pick: (settings: Settings) => SettingsSections[K]): SectionForm<K> {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const saved = settings ? pick(settings) : null;
  const [draft, setDraft] = useState<SettingsSections[K] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // Первый показ — черновик из сохранённых настроек.
  if (saved && draft === null) setDraft(saved);

  const mutation = useMutation({
    mutationFn: (body: SettingsSections[K]) => api.put<Settings>(`/settings/${section}`, body),
    onSuccess: (next) => {
      queryClient.setQueryData(['settings'], next);
      setDraft(pick(next));
      setErrors([]);
      toast.success('Сохранено. Бот уже работает с новыми настройками.');
    },
    onError: (error) => {
      if (error instanceof ApiFailure && error.status === 400) {
        setErrors(error.errors);
        toast.error('Не сохранено — проверь ошибки на странице.');
      } else toast.error(errorText(error));
    },
  });

  const dirty = draft !== null && saved !== null && !same(draft, saved);
  useUnsavedWarning(section, dirty);

  return {
    draft,
    update: (change) => setDraft((current) => (current ? change(current) : current)),
    dirty,
    saving: mutation.isPending,
    errors,
    save: () => draft && mutation.mutate(draft),
    reset: () => {
      setDraft(saved);
      setErrors([]);
    },
  };
}

/** Браузер спросит «Покинуть страницу?», а меню админки — «Уйти без сохранения?», если есть несохранённые изменения. */
function useUnsavedWarning(section: string, dirty: boolean) {
  useEffect(() => {
    markDirty(section, dirty);
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => {
      markDirty(section, false);
      removeEventListener('beforeunload', warn);
    };
  }, [section, dirty]);
}

/** Обновить вложенный объект черновика: update(set('channels', { welcome: id })). */
export function patch<T extends object, P extends keyof T>(key: P, value: Partial<T[P]>) {
  return (draft: T): T => ({ ...draft, [key]: { ...draft[key], ...value } });
}
