// Поиск мата в тексте. Слово сначала «очищается» от маскировки:
//   регистр, ё→е, латинские буквы-двойники (xyй → хуй), цифры (6ля → бля),
//   точки и звёздочки внутри слова (х.у.й), повторы букв (пиииздец), буквы через пробел (с у к а).
// Потом корни проверяются регулярными выражениями — с исключениями для обычных слов
// («употреблять», «застрахуй», «хулиган», «мудрый», «гондола», «сукно»…).

/** Латинские буквы и цифры, похожие на русские. */
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и', r: 'г', n: 'п',
  '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а', '$': 'с',
};

/**
 * Насколько строго: mat — мат и оскорбления по национальности и ориентации; rude — ещё и грубые слова
 * (сука, мудак, шлюха…). Настраивается в админке, страница «Фильтр мата».
 */
export type ProfanityLevel = 'mat' | 'rude';

/** Мат на кириллице (после очистки и схлопывания повторов) — ловится на любом уровне. */
const CYRILLIC_MAT: RegExp[] = [
  /ху[йяеию]/, // хуй, хуя, хуе(ть), хуи, хую
  /^(?:на|по|ни)?хул[иь]$/, // хули, нахуль
  /пизд/,
  /^(?:за|на|у|вы|въ|съ|разъ|объ|отъ|подъ|до|по|про|пере|при|недо|долбо|раз)?еб(?:а|у|л|н|ы|о|и|е|с|т|ч|$)/,
  /долбое/,
  /^бля(?:$|д|т|ть|дь|ха-?муха|ск)/,
  /залуп/,
  /^манд(?:а|ы|е|у|ой)$|мандав[оа]ш/,
  /пид[оа]р|пидр/,
];

/** Грубые слова на кириллице — только на уровне «мат и грубые слова». */
const CYRILLIC_RUDE: RegExp[] = [
  /^сук(?:а|и|у|е|ой|ам|ами|ах|ин\p{L}*)$/u,
  /^суч(?:ар|ка|ки|ку|ке|кой|ье|ий)/,
  /^муд(?:ак|ач|ил|о[зх]|ло)/,
  /^педик(?:и|а|у|ов|ом)?$/,
  /г[ао]ндон/,
  /шлюх/,
  /шалав/,
  /^дроч/,
  /^курв/,
];

/** Мат транслитом и английский мат с оскорблениями (латиница, после схлопывания повторов). */
const LATIN_MAT: RegExp[] = [
  /^(?:na|po|ni|do|o)?h[uy](?:i|j|y|ya|yu|ye)/,
  /pizd|pezd/,
  /^bl[yi]a(?:$|t|d)|^blyad|^blyat/,
  /^(?:za|na|vy|ot|do|po|pro|pere|u|s)?y?eb(?:at|al|an|lo|nu|uch)/,
  /pid[oa]r/,
  /^zalup/,
  /fuck|fuk(?:ing)?$/,
  /^cunts?$/,
  /^motherf/,
  /nig(?:er|a)s?$/,
  /^fagot/,
];

/** Грубые слова транслитом и по-английски. */
const LATIN_RUDE: RegExp[] = [/^suk(?:a|i)$/, /^mudak/, /^g[ao]nd[oa]n$/, /^(?:bul)?shit/, /bitch/, /^ashole/];

/** Обычные слова, в которых встречаются «плохие» сочетания букв. */
const WHITELIST = [/страху/, /хулиган/, /бляшк/, /^бляха$/, /мудр/, /педикюр/, /гондол/, /сукн/, /рубаху/];

const collapse = (word: string) => word.replace(/(.)\1+/g, '$1');

function toCyrillic(word: string): string {
  return [...word].map((ch) => LOOKALIKE[ch] ?? ch).join('');
}

/** Разбивает текст на слова, склеивая «с у к а» и «х.у.й». */
function words(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}@$]/gu, ''))
    .filter(Boolean);

  const result: string[] = [];
  let letters = '';
  for (const token of tokens) {
    if ([...token].length === 1) {
      letters += token;
      continue;
    }
    if (letters.length >= 3) result.push(letters);
    else if (letters) result.push(...letters);
    letters = '';
    result.push(token);
  }
  if (letters.length >= 3) result.push(letters);
  return result;
}

function isProfane(word: string, extra: readonly RegExp[], level: ProfanityLevel): boolean {
  const rude = level === 'rude';
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(word);
  const hasLatin = /[a-z]/.test(word);

  // Кириллица или смесь алфавитов (xyй) → переводим двойники в кириллицу.
  if (hasCyrillic || !hasLatin) {
    const cyr = collapse(toCyrillic(word));
    if (WHITELIST.some((re) => re.test(cyr))) return false;
    return CYRILLIC_MAT.some((re) => re.test(cyr)) || (rude && CYRILLIC_RUDE.some((re) => re.test(cyr))) || extra.some((re) => re.test(cyr));
  }

  // Чистая латиница: транслит (blyat, suka) и английская брань.
  const latin = collapse(word);
  return LATIN_MAT.some((re) => re.test(latin)) || (rude && LATIN_RUDE.some((re) => re.test(latin))) || extra.some((re) => re.test(latin));
}

/** Возвращает первое найденное матерное слово или null. extraWords — свои слова из настроек (ловятся на любом уровне). */
export function findProfanity(text: string, extraWords: readonly string[] = [], level: ProfanityLevel = 'rude'): string | null {
  const extra = extraWords.map((word) => new RegExp(`^${collapse(word.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  return words(text).find((word) => isProfane(word, extra, level)) ?? null;
}
