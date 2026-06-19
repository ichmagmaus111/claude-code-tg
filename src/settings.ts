import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Lang, DEFAULT_LANG, LANGS } from './i18n.js';
import type { ChatScope } from './telegram.js';

const STORE_FILE = join(process.cwd(), '.claude-bot-settings.json');

interface ChatSettings {
  lang?: Lang;
  cwd?: string;
}

/** Per-chat настройки бота (язык и т.п.) с персистом на диск. */
export class SettingsStore {
  private byScope = new Map<string, ChatSettings>();

  constructor() {
    this.load();
  }

  /** Выбран ли язык (для гейта первого входа). */
  hasLang(scope: ChatScope): boolean {
    return !!(this.byScope.get(scope.key)?.lang ?? this.byScope.get(scope.rootKey)?.lang);
  }

  /** Язык чата для рендера (с дефолтом, если ещё не выбран). */
  lang(scope: ChatScope): Lang {
    return this.byScope.get(scope.key)?.lang ?? this.byScope.get(scope.rootKey)?.lang ?? DEFAULT_LANG;
  }

  setLang(scope: ChatScope, lang: Lang): void {
    if (!LANGS.includes(lang)) return;
    const s = this.byScope.get(scope.key) ?? {};
    s.lang = lang;
    this.byScope.set(scope.key, s);
    this.save();
  }

  /** Выбранная рабочая папка проекта для чата (если задана через /cd). */
  getCwd(scope: ChatScope): string | undefined {
    return this.byScope.get(scope.key)?.cwd ?? this.byScope.get(scope.rootKey)?.cwd;
  }

  setCwd(scope: ChatScope, cwd: string): void {
    const s = this.byScope.get(scope.key) ?? {};
    s.cwd = cwd;
    this.byScope.set(scope.key, s);
    this.save();
  }

  private load(): void {
    try {
      const raw = readFileSync(STORE_FILE, 'utf8');
      const data = JSON.parse(raw) as Record<string, ChatSettings>;
      for (const [key, s] of Object.entries(data)) {
        this.byScope.set(key, s);
      }
    } catch {
      /* файла ещё нет — норма */
    }
  }

  private save(): void {
    const data: Record<string, ChatSettings> = {};
    for (const [key, s] of this.byScope) data[key] = s;
    try {
      writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Не удалось сохранить настройки:', err);
    }
  }
}
