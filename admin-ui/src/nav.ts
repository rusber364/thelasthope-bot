// Разделы админки: пункты бокового меню и карточки на главной.
import {
  Bell,
  CalendarClock,
  ChartColumn,
  ClipboardList,
  Eraser,
  HandMetal,
  Hash,
  LayoutDashboard,
  Pin,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  title: string;
  icon: LucideIcon;
  /** Подсказка на карточке раздела на главной. */
  description: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const HOME: NavItem = { to: '/', title: 'Главная', icon: LayoutDashboard, description: 'Сводка по серверу и боту.' };

export const NAV: NavGroup[] = [
  {
    title: 'Сервер',
    items: [
      { to: '/channels', title: 'Каналы и роли', icon: Hash, description: 'Правила, гостевая роль и автороль, голосовые роли.' },
      { to: '/welcome', title: 'Приветствие', icon: HandMetal, description: 'Сообщение новичкам в канале и в личке, прощание.' },
      {
        to: '/logs',
        title: 'Логи',
        icon: ScrollText,
        description: 'Каналы журналов: участники, сервер, сообщения, голос, модерация, реги.',
      },
      { to: '/alerts', title: 'Оповещения', icon: Bell, description: 'Сигналы офицерам: поздние отмены, посещаемость, инциденты.' },
      {
        to: '/botlog',
        title: 'Лог бота',
        icon: SquareTerminal,
        description: 'Что бот писал в консоль: запуски, реги, обрывы связи, ошибки.',
      },
    ],
  },
  {
    title: 'Сборы',
    items: [
      {
        to: '/templates',
        title: 'Сборы',
        icon: CalendarClock,
        description: 'Шаблоны рейдов, подземелий и PvP: расписание, лимиты по ролям, кто записывается, создание реги в пару кликов.',
      },
      {
        to: '/raids',
        title: 'Настройки рег',
        icon: SlidersHorizontal,
        description: 'Размер по умолчанию, временная роль, список рейдов, архив, события.',
      },
      { to: '/attendance', title: 'Посещаемость', icon: ChartColumn, description: 'Кто приходил на рейды за выбранный период.' },
    ],
  },
  {
    title: 'Сообщество',
    items: [
      { to: '/polls', title: 'Опросы', icon: ClipboardList, description: 'Создание анкет, итоги, ответы по людям, CSV.' },
      { to: '/sticky', title: 'Липкие сообщения', icon: Pin, description: 'Сообщения, которые всегда внизу канала.' },
      { to: '/autoclean', title: 'Автоочистка', icon: Eraser, description: 'Удаление старых сообщений в выбранных каналах.' },
      {
        to: '/sveta',
        title: 'Света',
        icon: Sparkles,
        description: 'ИИ-персонаж в выбранных каналах: характер, модель Gemini, потолки ответов.',
      },
    ],
  },
];

/** Раздел по адресу — для заголовка в шапке. */
export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') return HOME;
  return NAV.flatMap((group) => group.items).find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}
