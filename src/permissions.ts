import { Bot, InputFile } from 'grammy';
import type {
  PermissionResult,
  PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';
import { summarizeToolUse, sendHtml, sendRichMarkdown } from './render.js';
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

// Принятие плана: разрешаем ExitPlanMode и тут же выходим из plan в acceptEdits.
const EXIT_PLAN_TO_ACCEPT: PermissionUpdate = {
  type: 'setMode',
  mode: 'acceptEdits',
  destination: 'session',
};

/**
 * Связывает запросы разрешений Claude с inline-кнопками Telegram.
 * Обычные инструменты — Allow / Always / Deny. ExitPlanMode (plan-mode) —
 * отдельный поток: план в .md + рендер + Принять / Отклонить.
 */
export class PermissionManager {
  private pending = new Map<string, Pending>();
  private planPending = new Map<string, Pending>();
  private counter = 0;

  constructor(
    private readonly bot: Bot,
    private readonly settings: SettingsStore,
    private readonly token: string,
  ) {
    this.registerCallbacks();
  }

  createPrompter(chatId: number): PermissionPrompter {
    return (req) => this.prompt(chatId, req);
  }

  private async prompt(chatId: number, req: PermissionRequest): Promise<PermissionResult> {
    if (req.toolName === 'ExitPlanMode') {
      return this.promptPlan(chatId, req);
    }

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

  /** Поток подтверждения плана: рендер + .md-файл + кнопки Принять / Отклонить. */
  private async promptPlan(chatId: number, req: PermissionRequest): Promise<PermissionResult> {
    const s = S(this.settings.lang(chatId));
    const id = String(++this.counter);
    const plan =
      typeof req.input.plan === 'string' && req.input.plan.trim()
        ? (req.input.plan as string)
        : req.title || 'План';

    await sendHtml(this.bot.api, chatId, `${tg('pencil')} <b>${s.planTitle}</b>`);
    await sendRichMarkdown(this.token, chatId, plan); // рендер плана (best-effort)

    const buttons = kb([
      [
        btn(s.btnApprovePlan, `plan:${id}:ok`, 'check'),
        btn(s.btnRejectPlan, `plan:${id}:no`, 'cross'),
      ],
    ]);
    // .md-файл с полным планом + кнопки на нём
    await this.bot.api.sendDocument(chatId, new InputFile(Buffer.from(plan, 'utf8'), 'plan.md'), {
      caption: s.planFileCaption,
      reply_markup: buttons,
    });

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.planPending.delete(id);
        resolve({ behavior: 'deny', message: s.permTimeout });
      }, TIMEOUT_MS);
      this.planPending.set(id, { resolve, timer });
    });
  }

  private registerCallbacks(): void {
    // обычные разрешения
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
      let toast: string; // тост — без кастом-эмодзи (Telegram их там не рендерит)
      let html: string; // editMessageText — с премиум-эмодзи
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

    // подтверждение плана
    this.bot.callbackQuery(/^plan:(\d+):(ok|no)$/, async (ctx) => {
      const s = S(this.settings.lang(ctx.chat?.id ?? 0));
      const id = ctx.match[1];
      const ok = ctx.match[2] === 'ok';
      const entry = this.planPending.get(id);
      if (!entry) {
        await ctx.answerCallbackQuery({ text: s.staleRequest });
        try {
          await ctx.editMessageReplyMarkup();
        } catch {
          /* игнор */
        }
        return;
      }
      this.planPending.delete(id);
      clearTimeout(entry.timer);

      if (ok) {
        // разрешаем ExitPlanMode и переключаем сессию в acceptEdits
        entry.resolve({ behavior: 'allow', updatedPermissions: [EXIT_PLAN_TO_ACCEPT] });
        await ctx.answerCallbackQuery({ text: s.btnApprovePlan });
        await sendHtml(this.bot.api, ctx.chat?.id ?? 0, s.planApproved);
      } else {
        entry.resolve({ behavior: 'deny', message: s.planDenyReason });
        await ctx.answerCallbackQuery({ text: s.btnRejectPlan });
        await sendHtml(this.bot.api, ctx.chat?.id ?? 0, s.planRejected);
      }
      try {
        await ctx.editMessageReplyMarkup(); // убираем кнопки с .md-сообщения
      } catch {
        /* игнор */
      }
    });
  }

  /** Сбрасывает все ожидающие запросы как deny (например при /new или завершении сессии). */
  rejectAll(reason: string): void {
    for (const map of [this.pending, this.planPending]) {
      for (const [, entry] of map) {
        clearTimeout(entry.timer);
        entry.resolve({ behavior: 'deny', message: reason });
      }
      map.clear();
    }
  }
}
