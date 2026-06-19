import { Bot } from 'grammy';
import type {
  PermissionResult,
  PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';
import { summarizeToolUse } from './render.js';
import { tg, escapeHtml, btn, kb, type PremiumButton } from './emoji.js';
import { S } from './i18n.js';
import type { SettingsStore } from './settings.js';

export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  suggestions?: PermissionUpdate[];
}

/** Функция, которую вызывает сессия Claude, когда инструмент требует разрешения. */
export type PermissionPrompter = (req: PermissionRequest) => Promise<PermissionResult>;

interface Pending {
  resolve: (r: PermissionResult) => void;
  suggestions?: PermissionUpdate[];
  timer: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 10 * 60 * 1000; // 10 минут на решение, иначе deny

/**
 * Связывает запросы разрешений Claude с inline-кнопками Telegram.
 * Создаёт по prompter'у на чат и обрабатывает нажатия Allow / Allow always / Deny.
 */
export class PermissionManager {
  private pending = new Map<string, Pending>();
  private counter = 0;

  constructor(
    private readonly bot: Bot,
    private readonly settings: SettingsStore,
  ) {
    this.registerCallbacks();
  }

  createPrompter(chatId: number): PermissionPrompter {
    return (req) => this.prompt(chatId, req);
  }

  private async prompt(
    chatId: number,
    req: PermissionRequest,
  ): Promise<PermissionResult> {
    const s = S(this.settings.lang(chatId));
    const id = String(++this.counter);
    const hasSuggestions = !!req.suggestions?.length;

    const row: PremiumButton[] = [btn(s.btnAllow, `perm:${id}:allow`, 'check')];
    if (hasSuggestions) row.push(btn(s.btnAlways, `perm:${id}:always`, 'unlock'));
    row.push(btn(s.btnDeny, `perm:${id}:deny`, 'cross'));

    const lines = [
      `${tg('lock')} <b>${s.permTitle}</b>`,
      escapeHtml(req.title || summarizeToolUse(req.toolName, req.input)),
    ];
    if (req.description) lines.push(escapeHtml(req.description));
    lines.push('', s.permTool(req.toolName));

    await this.bot.api.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: kb([row]),
    });

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ behavior: 'deny', message: s.permTimeout });
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, suggestions: req.suggestions, timer });
    });
  }

  private registerCallbacks(): void {
    this.bot.callbackQuery(/^perm:(\d+):(allow|always|deny)$/, async (ctx) => {
      const s = S(this.settings.lang(ctx.chat?.id ?? 0));
      const id = ctx.match[1];
      const action = ctx.match[2];
      const entry = this.pending.get(id);
      if (!entry) {
        await ctx.answerCallbackQuery({ text: s.staleRequest });
        try {
          await ctx.editMessageReplyMarkup();
        } catch {
          /* кнопки уже могли быть убраны */
        }
        return;
      }
      this.pending.delete(id);
      clearTimeout(entry.timer);

      let result: PermissionResult;
      let toast: string; // текст для answerCallbackQuery — без кастом-эмодзи (тосты их не рендерят)
      let html: string; // текст для editMessageText — с премиум-эмодзи
      if (action === 'allow') {
        result = { behavior: 'allow' };
        toast = s.toastAllowed;
        html = `${tg('check')} <b>${s.decAllowed}</b>`;
      } else if (action === 'always') {
        result = { behavior: 'allow', updatedPermissions: entry.suggestions };
        toast = s.toastAlways;
        html = `${tg('unlock')} <b>${s.decAlways}</b>`;
      } else {
        result = { behavior: 'deny', message: s.denyReason };
        toast = s.toastDenied;
        html = `${tg('cross')} <b>${s.decDenied}</b>`;
      }

      entry.resolve(result);
      await ctx.answerCallbackQuery({ text: toast });
      try {
        await ctx.editMessageText(html, { parse_mode: 'HTML' });
      } catch {
        try {
          await ctx.editMessageReplyMarkup();
        } catch {
          /* игнор */
        }
      }
    });
  }

  /** Сбрасывает все ожидающие запросы как deny (например при /new или завершении сессии). */
  rejectAll(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ behavior: 'deny', message: reason });
    }
    this.pending.clear();
  }
}
