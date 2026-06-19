import type { InlineKeyboardMarkup } from 'grammy/types';

/**
 * Премиум-эмодзи (custom emoji) Telegram.
 * Работают, потому что у владельца бота есть Telegram Premium.
 * - В тексте сообщений: через {@link tg} + parse_mode: 'HTML'.
 * - На inline-кнопках: через поле icon_custom_emoji_id (без эмодзи в тексте).
 */
export const EMOJI = {
  bot: { id: '6030400221232501136', fb: '🤖' },
  settings: { id: '5870982283724328568', fb: '⚙️' },
  lock: { id: '6037249452824072506', fb: '🔒' },
  unlock: { id: '6037496202990194718', fb: '🔓' },
  check: { id: '5870633910337015697', fb: '✅' },
  cross: { id: '5870657884844462243', fb: '❌' },
  stats: { id: '5870921681735781843', fb: '📊' },
  file: { id: '5870528606328852614', fb: '📁' },
  reload: { id: '5345906554510012647', fb: '🔄' },
  code: { id: '5940433880585605708', fb: '🔨' },
  info: { id: '6028435952299413210', fb: 'ℹ️' },
  denied: { id: '5893192487324880883', fb: '🚫' },
  brush: { id: '6050679691004612757', fb: '🖌' },
  media: { id: '6035128606563241721', fb: '🖼' },
  people: { id: '5870772616305839506', fb: '👥' },
  pencil: { id: '5870676941614354370', fb: '🖋' },
  clock: { id: '5983150113483134607', fb: '⏰' },
} as const;

export type EmojiName = keyof typeof EMOJI;

/** Премиум-эмодзи для HTML-текста: <tg-emoji emoji-id="...">fallback</tg-emoji>. */
export function tg(name: EmojiName): string {
  const e = EMOJI[name];
  return `<tg-emoji emoji-id="${e.id}">${e.fb}</tg-emoji>`;
}

/** Экранирование пользовательских/динамических данных под parse_mode: 'HTML'. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Кнопка inline-клавиатуры с премиум-иконкой (без эмодзи в тексте). */
export interface PremiumButton {
  text: string;
  callback_data?: string;
  url?: string;
  icon_custom_emoji_id?: string;
}

/** callback-кнопка с опциональной премиум-иконкой. */
export function btn(text: string, data: string, icon?: EmojiName): PremiumButton {
  return icon
    ? { text, callback_data: data, icon_custom_emoji_id: EMOJI[icon].id }
    : { text, callback_data: data };
}

/** Собирает reply_markup из рядов премиум-кнопок (поле icon_custom_emoji_id пробрасывается как есть). */
export function kb(rows: PremiumButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows } as unknown as InlineKeyboardMarkup;
}
