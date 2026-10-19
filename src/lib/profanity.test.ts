import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findProfanity } from './profanity.ts';

const bad = [
  'ну ты и хуй',
  'ПИЗДЕЦ',
  'бля, опять вайп',
  'блять',
  'заебал уже',
  'ёбаный танк',
  'долбоёб',
  'сука',
  'мудак',
  'пидор',
  'нахуй',
  'похуй вообще',
  'охуенно',
  'xyй',
  'пиииздец',
  'х.у.й',
  'с у к а',
  'п и з д а',
  '6ля',
  'blyat',
  'suka',
  'suki',
  'pizdec',
  'nahuy',
  'zaebal',
  'fuck this',
  'bullshit',
  'курва',
  'хули ты',
];

const good = [
  'Привет всем, идём в рейд в 20:00',
  'употреблять',
  'оскорблять нельзя',
  'небо',
  'хлеб',
  'себе',
  'ребёнок',
  'мебель',
  'подстрахуй хила',
  'застрахую',
  'хулиган',
  'мудрый совет',
  'гондола',
  'сукно',
  'бляха на ремне',
  'педикюр',
  'учебник',
  'погребение',
  'употребление',
  'ebay',
  'ebook',
  'ebola',
  'huge',
  'hue',
  'Scunthorpe',
  'class',
  'хорошо',
  'Тельдрассил',
  'Альянс',
  'рубаху',
  'чихуахуа',
  'страхует',
];

for (const text of bad) {
  test(`ловит: «${text}»`, () => assert.ok(findProfanity(text), `не поймал «${text}»`));
}

for (const text of good) {
  test(`не трогает: «${text}»`, () => assert.equal(findProfanity(text), null, `ложное срабатывание на «${text}»`));
}

test('дополнительные слова из настроек', () => {
  assert.ok(findProfanity('ну ты нуб', ['нуб']));
  assert.equal(findProfanity('ну ты нуб'), null);
});

test('уровень «только мат»: грубые слова пропускаются, мат и оскорбления по национальности и ориентации ловятся', () => {
  for (const text of ['ну ты и сука', 'мудак', 'шлюха', 'гондон', 'suka', 'bitch', 'bullshit']) {
    assert.equal(findProfanity(text, [], 'mat'), null, `«${text}» — грубое слово, не мат`);
    assert.ok(findProfanity(text, [], 'rude'), `«${text}» на уровне «мат и грубые слова» ловится`);
  }
  for (const text of ['ну ты и хуй', 'заебал уже', 'бля', 'пидор', 'fuck', 'nigger', 'blyat']) {
    assert.ok(findProfanity(text, [], 'mat'), `«${text}» ловится и на уровне «только мат»`);
  }
  assert.ok(findProfanity('ну ты нуб', ['нуб'], 'mat'), 'свои слова — на любом уровне');
});
