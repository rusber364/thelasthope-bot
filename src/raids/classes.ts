// Классы и специализации WoW Forever: 9 классов по 3 спека. У друида «Сила зверя» в записи
// разделена на кошку и медведя, чтобы рейд-лидер видел, кто танкует. Список можно менять — бот подхватит его сам.
// icon — имя родной иконки WoW на wowhead: бот сам загружает их как свои эмодзи при запуске.

export type RaidRole = 'tank' | 'healer' | 'melee' | 'ranged';

export interface WowClass {
  id: string;
  name: string;
  icon: string;
}

export interface WowSpec {
  id: string;
  classId: string;
  name: string;
  role: RaidRole;
  icon: string;
}

export const ROLES: Record<RaidRole, { title: string; one: string }> = {
  tank: { title: 'Танки', one: 'Танк' },
  healer: { title: 'Лекари', one: 'Лекарь' },
  melee: { title: 'Ближний бой', one: 'Ближний бой' },
  ranged: { title: 'Дальний бой', one: 'Дальний бой' },
};

/**
 * Порядок колонок в реге. Discord ставит по три колонки в ряд, поэтому
 * танки, ближний и дальний бой идут первым рядом, а лекари — под танками.
 */
export const ROLE_ORDER: RaidRole[] = ['tank', 'melee', 'ranged', 'healer'];

export const CLASSES: WowClass[] = [
  { id: 'warrior', name: 'Воин', icon: 'classicon_warrior' },
  { id: 'paladin', name: 'Паладин', icon: 'classicon_paladin' },
  { id: 'hunter', name: 'Охотник', icon: 'classicon_hunter' },
  { id: 'rogue', name: 'Разбойник', icon: 'classicon_rogue' },
  { id: 'priest', name: 'Жрец', icon: 'classicon_priest' },
  { id: 'shaman', name: 'Шаман', icon: 'classicon_shaman' },
  { id: 'mage', name: 'Маг', icon: 'classicon_mage' },
  { id: 'warlock', name: 'Чернокнижник', icon: 'classicon_warlock' },
  { id: 'druid', name: 'Друид', icon: 'classicon_druid' },
];

export const SPECS: WowSpec[] = [
  { id: 'warrior_arms', classId: 'warrior', name: 'Оружие', role: 'melee', icon: 'ability_warrior_savageblow' },
  { id: 'warrior_fury', classId: 'warrior', name: 'Неистовство', role: 'melee', icon: 'ability_warrior_innerrage' },
  { id: 'warrior_prot', classId: 'warrior', name: 'Защита', role: 'tank', icon: 'ability_warrior_defensivestance' },

  { id: 'paladin_holy', classId: 'paladin', name: 'Свет', role: 'healer', icon: 'spell_holy_holybolt' },
  { id: 'paladin_prot', classId: 'paladin', name: 'Защита', role: 'tank', icon: 'spell_holy_devotionaura' },
  { id: 'paladin_ret', classId: 'paladin', name: 'Воздаяние', role: 'melee', icon: 'spell_holy_auraoflight' },

  { id: 'hunter_bm', classId: 'hunter', name: 'Повелитель зверей', role: 'ranged', icon: 'ability_hunter_beasttaming' },
  { id: 'hunter_mm', classId: 'hunter', name: 'Стрельба', role: 'ranged', icon: 'ability_marksmanship' },
  { id: 'hunter_surv', classId: 'hunter', name: 'Выживание', role: 'melee', icon: 'ability_hunter_swiftstrike' },

  { id: 'rogue_assa', classId: 'rogue', name: 'Ликвидация', role: 'melee', icon: 'ability_rogue_eviscerate' },
  { id: 'rogue_combat', classId: 'rogue', name: 'Бой', role: 'melee', icon: 'ability_backstab' },
  { id: 'rogue_sub', classId: 'rogue', name: 'Скрытность', role: 'melee', icon: 'ability_stealth' },

  { id: 'priest_disc', classId: 'priest', name: 'Послушание', role: 'healer', icon: 'spell_holy_wordfortitude' },
  { id: 'priest_holy', classId: 'priest', name: 'Свет', role: 'healer', icon: 'spell_holy_guardianspirit' },
  { id: 'priest_shadow', classId: 'priest', name: 'Тьма', role: 'ranged', icon: 'spell_shadow_shadowwordpain' },

  { id: 'shaman_ele', classId: 'shaman', name: 'Стихии', role: 'ranged', icon: 'spell_nature_lightning' },
  { id: 'shaman_enh', classId: 'shaman', name: 'Совершенствование', role: 'melee', icon: 'spell_nature_lightningshield' },
  { id: 'shaman_resto', classId: 'shaman', name: 'Исцеление', role: 'healer', icon: 'spell_nature_magicimmunity' },

  { id: 'mage_arcane', classId: 'mage', name: 'Тайная магия', role: 'ranged', icon: 'spell_holy_magicalsentry' },
  { id: 'mage_fire', classId: 'mage', name: 'Огонь', role: 'ranged', icon: 'spell_fire_firebolt02' },
  { id: 'mage_frost', classId: 'mage', name: 'Лёд', role: 'ranged', icon: 'spell_frost_frostbolt02' },

  { id: 'warlock_aff', classId: 'warlock', name: 'Колдовство', role: 'ranged', icon: 'spell_shadow_deathcoil' },
  { id: 'warlock_demo', classId: 'warlock', name: 'Демонология', role: 'ranged', icon: 'spell_shadow_metamorphosis' },
  { id: 'warlock_destro', classId: 'warlock', name: 'Разрушение', role: 'ranged', icon: 'spell_shadow_rainoffire' },

  { id: 'druid_balance', classId: 'druid', name: 'Баланс', role: 'ranged', icon: 'spell_nature_starfall' },
  { id: 'druid_cat', classId: 'druid', name: 'Сила зверя (кошка)', role: 'melee', icon: 'ability_druid_catform' },
  { id: 'druid_bear', classId: 'druid', name: 'Сила зверя (медведь)', role: 'tank', icon: 'ability_racial_bearform' },
  { id: 'druid_resto', classId: 'druid', name: 'Исцеление', role: 'healer', icon: 'spell_nature_healingtouch' },
];

export const classById = new Map(CLASSES.map((wowClass) => [wowClass.id, wowClass]));
export const specById = new Map(SPECS.map((spec) => [spec.id, spec]));

export function specsOf(classId: string): WowSpec[] {
  return SPECS.filter((spec) => spec.classId === classId);
}

/** Имя эмодзи в Discord для класса или специализации (2–32 символа: буквы, цифры, «_»). */
export function emojiName(id: string): string {
  return `wf_${id}`;
}
