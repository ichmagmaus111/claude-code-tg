import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bot } from 'grammy';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from './config.js';
import { ClaudeSession, type SessionCallbacks } from './claudeSession.js';
import type { PermissionManager } from './permissions.js';
import {
  sendChunked,
  sendHtml,
  sendRichMarkdown,
  sendRichDraft,
  RICH_MAX,
  summarizeToolUse,
} from './render.js';
import { tg, escapeHtml } from './emoji.js';
import { S } from './i18n.js';
import type { SettingsStore } from './settings.js';
import { targetFromScope, type ChatScope, type TelegramTarget } from './telegram.js';

const STORE_FILE = join(process.cwd(), '.claude-bot-sessions.json');

/** Создаёт и переиспользует сессии Claude по чату/topic, рендерит их вывод в Telegram. */
export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();
  private lastSessionId = new Map<string, string>();
  private targets = new Map<string, TelegramTarget>();

  constructor(
    private readonly bot: Bot,
    private readonly config: Config,
    private readonly permissions: PermissionManager,
    private readonly settings: SettingsStore,
  ) {
    this.loadStore();
  }

  /** Возвращает активную сессию scope, создавая новую при отсутствии. */
  get(scope: ChatScope): ClaudeSession {
    this.targets.set(scope.key, targetFromScope(scope));
    let session = this.sessions.get(scope.key);
    if (!session) {
      session = this.create(scope);
      this.sessions.set(scope.key, session);
    }
    return session;
  }

  has(scope: ChatScope): boolean {
    return this.sessions.has(scope.key);
  }

  /** Завершает текущую сессию и создаёт свежую (для /new, /clear, /resume). */
  async reset(scope: ChatScope, resume?: string, cwd?: string): Promise<ClaudeSession> {
    this.targets.set(scope.key, targetFromScope(scope));
    const existing = this.sessions.get(scope.key);
    if (existing) {
      this.permissions.rejectAll(S(this.settings.lang(scope)).sessionRestarted, scope.key);
      await existing.close();
    }
    const session = this.create(scope, resume, cwd);
    this.sessions.set(scope.key, session);
    return session;
  }

  getLastSessionId(scope: ChatScope): string | undefined {
    return this.lastSessionId.get(scope.key);
  }

  private create(scope: ChatScope, resume?: string, cwd?: string): ClaudeSession {
    const token = this.config.botToken;
    const target = (): TelegramTarget => this.targets.get(scope.key) ?? targetFromScope(scope);
    // Состояние стриминга черновика (живёт в рамках одной сессии чата).
    let draftId = 1; // draft_id должен быть ненулевым; растёт по сообщениям
    let lastDraftAt = 0;
    let draftInFlight = false;
    const DRAFT_THROTTLE_MS = 800;

    const callbacks: SessionCallbacks = {
      onTextDelta: (accumulated) => {
        // Троттлим и шлём fire-and-forget — не блокируем поток сообщений.
        const now = Date.now();
        if (draftInFlight || now - lastDraftAt < DRAFT_THROTTLE_MS) return;
        lastDraftAt = now;
        draftInFlight = true;
        void sendRichDraft(token, target(), draftId, accumulated).finally(() => {
          draftInFlight = false;
        });
      },
      onText: async (text) => {
        // Финал: персистим настоящий ответ (черновик эфемерный).
        // Ответ Claude — markdown → Rich Message (Bot API 10.1); иначе plain-текст.
        if (text.trim().length <= RICH_MAX) {
          const ok = await sendRichMarkdown(token, target(), text);
          if (!ok) await sendChunked(this.bot.api, target(), text);
        } else {
          await sendChunked(this.bot.api, target(), text);
        }
        // Следующее сообщение — новый черновик.
        draftId += 1;
        lastDraftAt = 0;
      },
      onToolUse: async (name, input) => {
        await sendHtml(
          this.bot.api,
          target(),
          `${tg('code')} ${escapeHtml(summarizeToolUse(name, input))}`,
        );
      },
      onInit: async ({ sessionId, model, mode }) => {
        // Тихо запоминаем сессию — без баннера в чат (его видно по /status).
        this.lastSessionId.set(scope.key, sessionId);
        this.saveStore();
        console.log(`[scope ${scope.key}] сессия ${sessionId} (${model}, ${mode})`);
      },
      onResult: async (result) => {
        if (result.session_id) {
          this.lastSessionId.set(scope.key, result.session_id);
          this.saveStore();
        }
        // На успехе ничего не шлём — пользователь видит сам ответ агента.
        if (result.subtype !== 'success') {
          await sendHtml(
            this.bot.api,
            target(),
            S(this.settings.lang(scope)).turnError(result.subtype),
          );
        }
      },
      onError: async (message) => {
        await sendHtml(this.bot.api, target(), `${tg('cross')} ${escapeHtml(message)}`);
      },
    };

    // приоритет рабочей папки: явная (resume) > выбранная через /cd > из конфига
    const effectiveCwd = cwd ?? this.settings.getCwd(scope);

    return new ClaudeSession({
      config: this.config,
      prompter: this.permissions.createPrompter(scope),
      callbacks,
      resume,
      cwd: effectiveCwd,
      mode: this.config.defaultMode,
    });
  }

  /** Меняет рабочую папку чата (/cd) и стартует свежую сессию в ней. */
  async setProjectDir(scope: ChatScope, dir: string): Promise<void> {
    this.settings.setCwd(scope, dir);
    await this.reset(scope);
  }

  setMode(scope: ChatScope, mode: PermissionMode): Promise<void> {
    return this.get(scope).setMode(mode);
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.close();
    }
    this.sessions.clear();
  }

  private loadStore(): void {
    try {
      const raw = readFileSync(STORE_FILE, 'utf8');
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [key, sessionId] of Object.entries(data)) {
        this.lastSessionId.set(key, sessionId);
      }
    } catch {
      /* файла ещё нет — это нормально */
    }
  }

  private saveStore(): void {
    const data: Record<string, string> = {};
    for (const [key, sessionId] of this.lastSessionId) {
      data[key] = sessionId;
    }
    try {
      writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Не удалось сохранить store сессий:', err);
    }
  }
}
