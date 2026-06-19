import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Lang, DEFAULT_LANG, LANGS } from './i18n.js';

const STORE_FILE = join(process.cwd(), '.claude-bot-settings.json');

interface ChatSettings {
  lang?: Lang;
}

/** Per-chat настройки бота (язык и т.п.) с персистом на диск. */
export class SettingsStore {
  private byChat = new Map<number, ChatSettings>();

  constructor() {
    this.load();
  }

  /** Выбран ли язык (для гейта первого входа). */
  hasLang(chatId: number): boolean {
    return !!this.byChat.get(chatId)?.lang;
  }

  /** Язык чата для рендера (с дефолтом, если ещё не выбран). */
  lang(chatId: number): Lang {
    return this.byChat.get(chatId)?.lang ?? DEFAULT_LANG;
  }

  setLang(chatId: number, lang: Lang): void {
    if (!LANGS.includes(lang)) return;
    const s = this.byChat.get(chatId) ?? {};
    s.lang = lang;
    this.byChat.set(chatId, s);
    this.save();
  }

  private load(): void {
    try {
      const raw = readFileSync(STORE_FILE, 'utf8');
      const data = JSON.parse(raw) as Record<string, ChatSettings>;
      for (const [chatId, s] of Object.entries(data)) {
        this.byChat.set(Number(chatId), s);
      }
    } catch {
      /* файла ещё нет — норма */
    }
  }

  private save(): void {
    const data: Record<string, ChatSettings> = {};
    for (const [chatId, s] of this.byChat) data[chatId] = s;
    try {
      writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Не удалось сохранить настройки:', err);
    }
  }
}
