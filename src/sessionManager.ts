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

const STORE_FILE = join(process.cwd(), '.claude-bot-sessions.json');

/** Создаёт и переиспользует сессии Claude по chatId, рендерит их вывод в Telegram. */
export class SessionManager {
  private sessions = new Map<number, ClaudeSession>();
  private lastSessionId = new Map<number, string>();

  constructor(
    private readonly bot: Bot,
    private readonly config: Config,
    private readonly permissions: PermissionManager,
    private readonly settings: SettingsStore,
  ) {
    this.loadStore();
  }

  /** Возвращает активную сессию чата, создавая новую при отсутствии. */
  get(chatId: number): ClaudeSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = this.create(chatId);
      this.sessions.set(chatId, session);
    }
    return session;
  }

  has(chatId: number): boolean {
    return this.sessions.has(chatId);
  }

  /** Завершает текущую сессию и создаёт свежую (для /new, /clear, /resume). */
  async reset(chatId: number, resume?: string, cwd?: string): Promise<ClaudeSession> {
    const existing = this.sessions.get(chatId);
    if (existing) {
      this.permissions.rejectAll(S(this.settings.lang(chatId)).sessionRestarted);
      await existing.close();
    }
    const session = this.create(chatId, resume, cwd);
    this.sessions.set(chatId, session);
    return session;
  }

  getLastSessionId(chatId: number): string | undefined {
    return this.lastSessionId.get(chatId);
  }

  private create(chatId: number, resume?: string, cwd?: string): ClaudeSession {
    const token = this.config.botToken;
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
        void sendRichDraft(token, chatId, draftId, accumulated).finally(() => {
          draftInFlight = false;
        });
      },
      onText: async (text) => {
        // Финал: персистим настоящий ответ (черновик эфемерный).
        // Ответ Claude — markdown → Rich Message (Bot API 10.1); иначе plain-текст.
        if (text.trim().length <= RICH_MAX) {
          const ok = await sendRichMarkdown(token, chatId, text);
          if (!ok) await sendChunked(this.bot.api, chatId, text);
        } else {
          await sendChunked(this.bot.api, chatId, text);
        }
        // Следующее сообщение — новый черновик.
        draftId += 1;
        lastDraftAt = 0;
      },
      onToolUse: async (name, input) => {
        await sendHtml(
          this.bot.api,
          chatId,
          `${tg('code')} ${escapeHtml(summarizeToolUse(name, input))}`,
        );
      },
      onInit: async ({ sessionId, model, mode }) => {
        // Тихо запоминаем сессию — без баннера в чат (его видно по /status).
        this.lastSessionId.set(chatId, sessionId);
        this.saveStore();
        console.log(`[chat ${chatId}] сессия ${sessionId} (${model}, ${mode})`);
      },
      onResult: async (result) => {
        if (result.session_id) {
          this.lastSessionId.set(chatId, result.session_id);
          this.saveStore();
        }
        // На успехе ничего не шлём — пользователь видит сам ответ агента.
        if (result.subtype !== 'success') {
          await sendHtml(
            this.bot.api,
            chatId,
            S(this.settings.lang(chatId)).turnError(result.subtype),
          );
        }
      },
      onError: async (message) => {
        await sendHtml(this.bot.api, chatId, `${tg('cross')} ${escapeHtml(message)}`);
      },
    };

    return new ClaudeSession({
      config: this.config,
      prompter: this.permissions.createPrompter(chatId),
      callbacks,
      resume,
      cwd,
      mode: this.config.defaultMode,
    });
  }

  setMode(chatId: number, mode: PermissionMode): Promise<void> {
    return this.get(chatId).setMode(mode);
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
      for (const [chatId, sessionId] of Object.entries(data)) {
        this.lastSessionId.set(Number(chatId), sessionId);
      }
    } catch {
      /* файла ещё нет — это нормально */
    }
  }

  private saveStore(): void {
    const data: Record<string, string> = {};
    for (const [chatId, sessionId] of this.lastSessionId) {
      data[chatId] = sessionId;
    }
    try {
      writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Не удалось сохранить store сессий:', err);
    }
  }
}
