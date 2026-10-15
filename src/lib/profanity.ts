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

/** Корни на кириллице (после очистки и схлопывания повторов). */
const CYRILLIC: RegExp[] = [
  /ху[йяеию]/, // хуй, хуя, хуе(ть), хуи, хую
  /^(?:на|по|ни)?хул[иь]$/, // хули, нахуль
  /пизд/,
  /^(?:за|на|у|вы|въ|съ|разъ|объ|отъ|подъ|до|по|про|пере|при|недо|долбо|раз)?еб(?:а|у|л|н|ы|о|и|е|с|т|ч|$)/,
  /долбое/,
  /^бля(?:$|д|т|ть|дь|ха-?муха|ск)/,
  /^сук(?:а|и|у|е|ой|ам|ами|ах|ин\p{L}*)$/u,
  /^суч(?:ар|ка|ки|ку|ке|кой|ье|ий)/,
  /^муд(?:ак|ач|ил|о[зх]|ло)/,
  /пид[оа]р|пидр/,
  /^педик(?:и|а|у|ов|ом)?$/,
  /г[ао]ндон/,
  /залуп/,
  /шлюх/,
  /шалав/,
  /^дроч/,
  /^манд(?:а|ы|е|у|ой)$|мандав[оа]ш/,
  /^курв/,
];

/** Транслит и английская брань (латиница, после схлопывания повторов). */
const LATIN: RegExp[] = [
  /^(?:na|po|ni|do|o)?h[uy](?:i|j|y|ya|yu|ye)/,
  /pizd|pezd/,
  /^bl[yi]a(?:$|t|d)|^blyad|^blyat/,
  /^suk(?:a|i)$/,
  /^(?:za|na|vy|ot|do|po|pro|pere|u|s)?y?eb(?:at|al|an|lo|nu|uch)/,
  /pid[oa]r/,
  /^mudak/,
  /^g[ao]nd[oa]n$/,
  /^zalup/,
  /fuck|fuk(?:ing)?$/,
  /^(?:bul)?shit/,
  /bitch/,
  /^cunts?$/,
  /^ashole/,
  /^motherf/,
  /nig(?:er|a)s?$/,
  /^fagot/,
];

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

function isProfane(word: string, extra: readonly RegExp[]): boolean {
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(word);
  const hasLatin = /[a-z]/.test(word);

  // Кириллица или смесь алфавитов (xyй) → переводим двойники в кириллицу.
  if (hasCyrillic || !hasLatin) {
    const cyr = collapse(toCyrillic(word));
    if (WHITELIST.some((re) => re.test(cyr))) return false;
    return CYRILLIC.some((re) => re.test(cyr)) || extra.some((re) => re.test(cyr));
  }

  // Чистая латиница: транслит (blyat, suka) и английская брань.
  const latin = collapse(word);
  return LATIN.some((re) => re.test(latin)) || extra.some((re) => re.test(latin));
}

/** Возвращает первое найденное матерное слово или null. extraWords — дополнительные слова из настроек. */
export function findProfanity(text: string, extraWords: readonly string[] = []): string | null {
  const extra = extraWords.map((word) => new RegExp(`^${collapse(word.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  return words(text).find((word) => isProfane(word, extra)) ?? null;
}
