import { Bot, type Context } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import {
  listSessions,
  getSessionInfo,
  type PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';
import type { Config } from './config.js';
import { PERMISSION_MODES } from './config.js';
import { PermissionManager } from './permissions.js';
import { SessionManager } from './sessionManager.js';
import { SettingsStore } from './settings.js';
import { sendChunked, sendHtml } from './render.js';
import { tg, escapeHtml, btn, kb, type PremiumButton } from './emoji.js';
import { S, type Lang } from './i18n.js';
import {
  scopeFromContext,
  targetFromScope,
  withReplyTarget,
  withThread,
  type ChatScope,
} from './telegram.js';

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function baseName(path?: string): string {
  if (!path) return '?';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function expandPath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolvePath(homedir(), p.slice(2));
  return resolvePath(p);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Типы изображений, которые принимает Claude.
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export interface BuiltBot {
  bot: Bot;
  sessions: SessionManager;
}

export function buildBot(config: Config): BuiltBot {
  const bot = new Bot(config.botToken);
  // авто-ретраи исходящих вызовов API (429 rate limit, временные 5xx)
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));
  const settings = new SettingsStore();
  const permissions = new PermissionManager(bot, settings, config.botToken);
  const sessions = new SessionManager(bot, config, permissions, settings);
  // кандидаты для /cd: scope-key -> список путей (для коротких callback_data)
  const cdCandidates = new Map<string, string[]>();

  /** Строки на языке чата. */
  const t = (scope: ChatScope) => S(settings.lang(scope));

  // Скачивает медиа текущего сообщения из Telegram и кодирует в base64.
  const downloadBase64 = async (ctx: Context): Promise<string> => {
    const file = await ctx.getFile();
    if (!file.file_path) throw new Error('Telegram не вернул путь к файлу.');
    const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`не удалось скачать файл (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  };

  const guard =
    (handler: (ctx: Context, scope: ChatScope) => Promise<void>) =>
    async (ctx: Context) => {
      const scope = scopeFromContext(ctx);
      if (!scope) return;
      try {
        await handler(ctx, scope);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendHtml(bot.api, targetFromScope(scope), `${tg('cross')} ${escapeHtml(msg)}`);
      }
    };

  // ----- переиспользуемые панели (для /config и команд) -----
  const sendLanguageChooser = async (scope: ChatScope) => {
    const target = targetFromScope(scope);
    await bot.api.sendMessage(
      target.chatId,
      t(scope).chooseLanguage,
      withReplyTarget(target, {
        parse_mode: 'HTML' as const,
        reply_markup: kb([[btn('Русский', 'lang:ru'), btn('English', 'lang:en')]]),
      }),
    );
  };

  const showModeChooser = async (scope: ChatScope) => {
    const target = targetFromScope(scope);
    const s = t(scope);
    const rows: PremiumButton[][] = PERMISSION_MODES.map((m) => [
      btn(`${m} (${s.modeDesc[m] ?? ''})`, `mode:${m}`, 'settings'),
    ]);
    await bot.api.sendMessage(
      target.chatId,
      s.chooseMode,
      withReplyTarget(target, { parse_mode: 'HTML' as const, reply_markup: kb(rows) }),
    );
  };

  const showModelChooser = async (scope: ChatScope) => {
    const target = targetFromScope(scope);
    const s = t(scope);
    const models = await sessions.get(scope).listModels();
    if (models.length === 0) {
      await sendHtml(bot.api, target, s.modelsUnavailable);
      return;
    }
    const rows: PremiumButton[][] = models.map((m) => [btn(m.displayName, `model:${m.value}`, 'brush')]);
    await bot.api.sendMessage(
      target.chatId,
      s.chooseModel,
      withReplyTarget(target, { parse_mode: 'HTML' as const, reply_markup: kb(rows) }),
    );
  };

  // --- AUTH: пускаем только whitelisted Telegram ID ---
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && config.allowedUserIds.has(userId)) {
      return next();
    }
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Доступ запрещён / Access denied' });
    } else {
      const scope = scopeFromContext(ctx);
      if (scope) {
        await sendHtml(
          bot.api,
          targetFromScope(scope),
          t(scope).accessDenied(String(userId ?? '—')),
        );
      }
    }
  });

  // --- FIRST-RUN: при первом входе требуем выбрать язык ---
  bot.use(async (ctx, next) => {
    const scope = scopeFromContext(ctx);
    if (!scope) return next();
    if (ctx.callbackQuery?.data?.startsWith('lang:')) return next(); // сам выбор пропускаем
    if (settings.hasLang(scope)) return next();
    await sendLanguageChooser(scope);
    // дальше не пускаем — сперва язык
  });

  // --- Выбор языка ---
  bot.callbackQuery(/^lang:(ru|en)$/, guard(async (ctx, scope) => {
    const lang = ctx.match![1] as Lang;
    settings.setLang(scope, lang);
    const s = S(lang);
    await ctx.answerCallbackQuery({ text: s.langName });
    try {
      await ctx.editMessageText(s.languageSet, { parse_mode: 'HTML' as const });
    } catch {
      /* нечего редактировать */
    }
    await sendHtml(bot.api, targetFromScope(scope), s.help);
  }));

  // --- Справка ---
  bot.command(['start', 'help'], guard(async (ctx, scope) => {
    await sendHtml(bot.api, targetFromScope(scope), t(scope).help);
  }));

  bot.command('id', guard(async (ctx, scope) => {
    await sendHtml(bot.api, targetFromScope(scope), t(scope).yourId(String(ctx.from?.id)));
  }));

  // --- Настройки ---
  bot.command('config', guard(async (ctx, scope) => {
    const s = t(scope);
    const target = targetFromScope(scope);
    await bot.api.sendMessage(
      target.chatId,
      s.configTitle,
      withReplyTarget(target, {
        parse_mode: 'HTML' as const,
        reply_markup: kb([
          [btn(s.btnLanguage, 'cfg:lang', 'settings')],
          [btn(s.btnMode, 'cfg:mode', 'lock')],
          [btn(s.btnModel, 'cfg:model', 'brush')],
        ]),
      }),
    );
  }));

  bot.callbackQuery('cfg:lang', guard(async (ctx, scope) => {
    await ctx.answerCallbackQuery();
    await sendLanguageChooser(scope);
  }));
  bot.callbackQuery('cfg:mode', guard(async (ctx, scope) => {
    await ctx.answerCallbackQuery();
    await showModeChooser(scope);
  }));
  bot.callbackQuery('cfg:model', guard(async (ctx, scope) => {
    await ctx.answerCallbackQuery();
    await showModelChooser(scope);
  }));

  // --- Смена проекта (рабочей папки) ---
  const applyProjectDir = async (scope: ChatScope, dir: string, raw: string) => {
    const target = targetFromScope(scope);
    if (!isDir(dir)) {
      await sendHtml(bot.api, target, t(scope).cdNotDir(raw));
      return;
    }
    await sessions.setProjectDir(scope, dir);
    await sendHtml(bot.api, target, t(scope).projectSet(dir));
  };

  bot.command('cd', guard(async (ctx, scope) => {
    const arg = ctx.match?.toString().trim();
    if (arg) {
      await applyProjectDir(scope, expandPath(arg), arg);
      return;
    }
    // без аргумента — список недавних проектов (по cwd последних сессий + конфиг)
    const list = await listSessions({ limit: 50 });
    const dirs: string[] = [];
    const seen = new Set<string>();
    for (const d of [config.workingDir, ...list.map((s) => s.cwd)]) {
      if (d && !seen.has(d) && isDir(d)) {
        seen.add(d);
        dirs.push(d);
      }
      if (dirs.length >= 12) break;
    }
    if (dirs.length === 0) {
      await sendHtml(bot.api, targetFromScope(scope), t(scope).noProjects);
      return;
    }
    cdCandidates.set(scope.key, dirs);
    const rows: PremiumButton[][] = dirs.map((d, i) => [
      btn(`${baseName(d)}  —  ${d}`.slice(0, 60), `cd:${i}`, 'file'),
    ]);
    const target = targetFromScope(scope);
    await bot.api.sendMessage(
      target.chatId,
      t(scope).chooseProject,
      withReplyTarget(target, { parse_mode: 'HTML' as const, reply_markup: kb(rows) }),
    );
  }));

  bot.callbackQuery(/^cd:(\d+)$/, guard(async (ctx, scope) => {
    await ctx.answerCallbackQuery();
    const dir = cdCandidates.get(scope.key)?.[Number(ctx.match![1])];
    if (!dir) return;
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await applyProjectDir(scope, dir, dir);
  }));

  // --- Сброс / новая сессия ---
  bot.command(['new', 'clear'], guard(async (ctx, scope) => {
    await sessions.reset(scope);
    await sendHtml(bot.api, targetFromScope(scope), t(scope).newSession);
  }));

  // --- Выбор прошлой сессии (по всем проектам, свежие сверху) ---
  bot.command(['resume', 'sessions'], guard(async (ctx, scope) => {
    const list = await listSessions({ limit: 15 });
    list.sort((a, b) => b.lastModified - a.lastModified);
    if (list.length === 0) {
      await sendHtml(bot.api, targetFromScope(scope), t(scope).noSessions);
      return;
    }
    const rows: PremiumButton[][] = list.map((s) => {
      const title = (s.customTitle || s.summary || s.firstPrompt || s.sessionId)
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      const label = `${fmtDate(s.lastModified)} · ${baseName(s.cwd)} · ${title}`;
      return [btn(label.slice(0, 60), `resume:${s.sessionId}`, 'file')];
    });
    const target = targetFromScope(scope);
    await bot.api.sendMessage(
      target.chatId,
      t(scope).sessionsHeader(list.length),
      withReplyTarget(target, {
        parse_mode: 'HTML' as const,
        reply_markup: kb(rows),
      }),
    );
  }));

  // --- Статус ---
  bot.command('status', guard(async (ctx, scope) => {
    const s = sessions.get(scope);
    const tr = t(scope);
    await sendHtml(
      bot.api,
      targetFromScope(scope),
      tr.status(s.sessionId ?? tr.notInit, s.model, s.mode, s.cwd),
    );
  }));

  // --- Режим разрешений ---
  bot.command('mode', guard(async (ctx, scope) => {
    const arg = ctx.match?.toString().trim();
    if (arg) {
      if (!PERMISSION_MODES.includes(arg as PermissionMode)) {
        await sendHtml(
          bot.api,
          targetFromScope(scope),
          t(scope).unknownMode(PERMISSION_MODES.join(', ')),
        );
        return;
      }
      await sessions.setMode(scope, arg as PermissionMode);
      await sendHtml(bot.api, targetFromScope(scope), t(scope).modeSet(arg));
      return;
    }
    await showModeChooser(scope);
  }));

  // --- Модель ---
  bot.command('model', guard(async (ctx, scope) => {
    const arg = ctx.match?.toString().trim();
    if (arg) {
      await sessions.get(scope).setModel(arg);
      await sendHtml(bot.api, targetFromScope(scope), t(scope).modelSet(arg));
      return;
    }
    await showModelChooser(scope);
  }));

  bot.command('models', guard(async (ctx, scope) => {
    const models = await sessions.get(scope).listModels();
    const text = models.map((m) => `• ${m.displayName} — ${m.value}`).join('\n');
    await sendChunked(bot.api, targetFromScope(scope), text || t(scope).modelsUnavailable);
  }));

  // --- Список нативных слэш-команд Claude ---
  bot.command('commands', guard(async (ctx, scope) => {
    const cmds = await sessions.get(scope).listCommands();
    const text = cmds
      .map((c) => `/${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} — ${c.description}`)
      .join('\n');
    await sendChunked(bot.api, targetFromScope(scope), text || t(scope).noCommands);
  }));

  bot.command('agents', guard(async (ctx, scope) => {
    const agents = await sessions.get(scope).listAgents();
    const text = agents.map((a) => `• ${a.name} — ${a.description}`).join('\n');
    await sendChunked(bot.api, targetFromScope(scope), text || t(scope).noAgents);
  }));

  bot.command('mcp', guard(async (ctx, scope) => {
    const servers = await sessions.get(scope).mcpStatus();
    const text = servers.map((s) => `• ${s.name}: ${s.status}`).join('\n');
    await sendChunked(bot.api, targetFromScope(scope), text || t(scope).noMcp);
  }));

  // --- Прерывание ---
  bot.command('stop', guard(async (ctx, scope) => {
    if (!sessions.has(scope)) {
      await sendHtml(bot.api, targetFromScope(scope), t(scope).noActiveSession);
      return;
    }
    await sessions.get(scope).interrupt();
    await sendHtml(bot.api, targetFromScope(scope), t(scope).interrupted);
  }));

  // --- Callback: возобновление сессии ---
  bot.callbackQuery(/^resume:(.+)$/, guard(async (ctx, scope) => {
    const sessionId = ctx.match![1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    const info = await getSessionInfo(sessionId).catch(() => undefined);
    await sessions.reset(scope, sessionId, info?.cwd);
    await sendHtml(bot.api, targetFromScope(scope), t(scope).resumed(info?.cwd));
  }));

  // --- Callback: смена модели ---
  bot.callbackQuery(/^model:(.+)$/, guard(async (ctx, scope) => {
    const value = ctx.match![1];
    await sessions.get(scope).setModel(value);
    await ctx.answerCallbackQuery({ text: value });
    await ctx.editMessageText(t(scope).modelSet(value), { parse_mode: 'HTML' as const });
  }));

  // --- Callback: смена режима ---
  bot.callbackQuery(/^mode:(.+)$/, guard(async (ctx, scope) => {
    const mode = ctx.match![1] as PermissionMode;
    await sessions.setMode(scope, mode);
    await ctx.answerCallbackQuery({ text: mode });
    await ctx.editMessageText(t(scope).modeSet(mode), { parse_mode: 'HTML' as const });
  }));

  // --- Любой текст (и непойманные слэш-команды) → в Claude ---
  bot.on('message:text', guard(async (ctx, scope) => {
    const text = ctx.message?.text;
    if (!text) return;
    const target = targetFromScope(scope);
    await ctx.api.sendChatAction(target.chatId, 'typing', withThread(target, {}));
    sessions.get(scope).send(text);
  }));

  // --- Фото → Claude (мультимодально) ---
  bot.on('message:photo', guard(async (ctx, scope) => {
    const target = targetFromScope(scope);
    const caption = ctx.message?.caption?.trim() || t(scope).imagePrompt;
    await ctx.api.sendChatAction(target.chatId, 'typing', withThread(target, {}));
    const data = await downloadBase64(ctx);
    sessions.get(scope).sendContent([
      { type: 'text', text: caption },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
    ]);
  }));

  // --- Картинка файлом (документом) ---
  bot.on('message:document', guard(async (ctx, scope) => {
    const target = targetFromScope(scope);
    const mime = ctx.message?.document?.mime_type ?? '';
    if (!mime.startsWith('image/')) {
      await sendHtml(bot.api, target, t(scope).notAnImage);
      return;
    }
    const caption = ctx.message?.caption?.trim() || t(scope).imagePrompt;
    await ctx.api.sendChatAction(target.chatId, 'typing', withThread(target, {}));
    const data = await downloadBase64(ctx);
    const media = ALLOWED_IMAGE_MIME.has(mime) ? mime : 'image/jpeg';
    sessions.get(scope).sendContent([
      { type: 'text', text: caption },
      { type: 'image', source: { type: 'base64', media_type: media, data } },
    ]);
  }));

  // --- Прочие медиа без поддержки контента ---
  bot.on('message', guard(async (ctx, scope) => {
    await sendHtml(bot.api, targetFromScope(scope), t(scope).mediaFallback);
  }));

  bot.catch((err) => {
    console.error('Ошибка в обработчике бота:', err.error);
  });

  return { bot, sessions };
}

/** Регистрирует меню команд (локализованное по языку клиента Telegram). */
export async function registerCommandMenu(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(S('ru').cmdMenu); // дефолт
  await bot.api.setMyCommands(S('en').cmdMenu, { language_code: 'en' });
}
