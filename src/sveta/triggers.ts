// Когда Света отвечает: её упомянули, ответили на её сообщение, позвали по имени — или (редко) встревает сама.

export type Trigger = 'mention' | 'reply' | 'name' | 'random';

export const TRIGGER_LABEL: Record<Trigger, string> = {
  mention: 'упомянули',
  reply: 'ответили на её сообщение',
  name: 'позвали по имени',
  random: 'встряла сама',
};

// «Света», «Светик», «Светочка»… — полные формы; короткое «Свет» — только с запятой или «!» после («Свет, глянь»),
// чтобы не отзываться на «свет погас». Имя считается обращением в начале, после запятой или после приветствия.
const FULL = '(?:света|светик|светочка|светка|светуля|светлана|светланка)';
const SHORT = 'свет(?=\\s*[,!?])';
const NAME = `(?:${FULL}|${SHORT})(?![\\p{L}])`;
const PATTERNS = [
  new RegExp(`^[\\s"«(*_~]*${NAME}`, 'iu'), // «Света, когда рейд?»
  new RegExp(`[,!]\\s*${NAME}`, 'iu'), // «а ты как думаешь, Света?»
  new RegExp(`(?<![\\p{L}])(?:привет|приветик|эй|хей|слушай|спасибо|спс|пока|ну)[\\s,!]+${NAME}`, 'iu'), // «привет света»
];

/** Позвали ли Свету по имени. */
export function callsByName(text: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(text));
}

export interface IncomingMessage {
  authorIsBot: boolean;
  channelId: string;
  content: string;
  mentionsSveta: boolean;
  replyToSveta: boolean;
}

/** Почему Свете стоит ответить (null — молчать). roll — случайное число 0…1 для «встрять самой». */
export function triggerOf(message: IncomingMessage, channelIds: readonly string[], randomPercent: number, roll: number): Trigger | null {
  if (message.authorIsBot || !channelIds.includes(message.channelId)) return null;
  if (message.mentionsSveta) return 'mention';
  if (message.replyToSveta) return 'reply';
  if (callsByName(message.content)) return 'name';
  // Встревает только в осмысленные сообщения, а не в «+» и «ок».
  if (message.content.trim().length >= 12 && roll * 100 < randomPercent) return 'random';
  return null;
}
