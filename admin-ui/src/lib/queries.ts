// Общие запросы: кто вошёл, сводка, варианты для списков, настройки.
import { useQuery } from '@tanstack/react-query';
import type { MeResponse, Option, OptionsResponse, OverviewResponse, Settings } from '@api';
import { api, rememberCsrf } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api.get<MeResponse>('/me');
      rememberCsrf(me);
      return me;
    },
    staleTime: 5 * 60_000,
  });
}

export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewResponse>('/overview') });

/** Каналы и роли сервера — для выпадающих списков. */
export const useOptions = () => useQuery({ queryKey: ['options'], queryFn: () => api.get<OptionsResponse>('/options'), staleTime: 60_000 });

/** Участники сервера (без ботов) — для выбора людей. */
export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: () => api.get<Option[]>('/members'), staleTime: 60_000 });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
