import { Bot, type Context } from 'grammy';
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

// Типы изображений, которые принимает Claude.
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export interface BuiltBot {
  bot: Bot;
  sessions: SessionManager;
}

export function buildBot(config: Config): BuiltBot {
  const bot = new Bot(config.botToken);
  const settings = new SettingsStore();
  const permissions = new PermissionManager(bot, settings);
  const sessions = new SessionManager(bot, config, permissions, settings);

  const chatId = (ctx: Context): number | undefined => ctx.chat?.id ?? ctx.from?.id;
  /** Строки на языке чата. */
  const t = (id: number) => S(settings.lang(id));

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
    (handler: (ctx: Context, id: number) => Promise<void>) =>
    async (ctx: Context) => {
      const id = chatId(ctx);
      if (id === undefined) return;
      try {
        await handler(ctx, id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendHtml(bot.api, id, `${tg('cross')} ${escapeHtml(msg)}`);
      }
    };

  // ----- переиспользуемые панели (для /config и команд) -----
  const sendLanguageChooser = async (id: number) => {
    await bot.api.sendMessage(id, t(id).chooseLanguage, {
      parse_mode: 'HTML',
      reply_markup: kb([[btn('Русский', 'lang:ru'), btn('English', 'lang:en')]]),
    });
  };

  const showModeChooser = async (id: number) => {
    const s = t(id);
    const rows: PremiumButton[][] = PERMISSION_MODES.map((m) => [
      btn(`${m} (${s.modeDesc[m] ?? ''})`, `mode:${m}`, 'settings'),
    ]);
    await bot.api.sendMessage(id, s.chooseMode, { parse_mode: 'HTML', reply_markup: kb(rows) });
  };

  const showModelChooser = async (id: number) => {
    const s = t(id);
    const models = await sessions.get(id).listModels();
    if (models.length === 0) {
      await sendHtml(bot.api, id, s.modelsUnavailable);
      return;
    }
    const rows: PremiumButton[][] = models.map((m) => [btn(m.displayName, `model:${m.value}`, 'brush')]);
    await bot.api.sendMessage(id, s.chooseModel, { parse_mode: 'HTML', reply_markup: kb(rows) });
  };

  // --- AUTH: пускаем только whitelisted Telegram ID ---
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && config.allowedUserIds.has(userId)) {
      return next();
    }
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Доступ запрещён / Access denied' });
    } else if (ctx.chat) {
      await sendHtml(bot.api, ctx.chat.id, t(ctx.chat.id).accessDenied(String(userId ?? '—')));
    }
  });

  // --- FIRST-RUN: при первом входе требуем выбрать язык ---
  bot.use(async (ctx, next) => {
    const id = chatId(ctx);
    if (id === undefined) return next();
    if (ctx.callbackQuery?.data?.startsWith('lang:')) return next(); // сам выбор пропускаем
    if (settings.hasLang(id)) return next();
    await sendLanguageChooser(id);
    // дальше не пускаем — сперва язык
  });

  // --- Выбор языка ---
  bot.callbackQuery(/^lang:(ru|en)$/, guard(async (ctx, id) => {
    const lang = ctx.match![1] as Lang;
    settings.setLang(id, lang);
    const s = S(lang);
    await ctx.answerCallbackQuery({ text: s.langName });
    try {
      await ctx.editMessageText(s.languageSet, { parse_mode: 'HTML' });
    } catch {
      /* нечего редактировать */
    }
    await sendHtml(bot.api, id, s.help);
  }));

  // --- Справка ---
  bot.command(['start', 'help'], guard(async (ctx, id) => {
    await sendHtml(bot.api, id, t(id).help);
  }));

  bot.command('id', guard(async (ctx, id) => {
    await sendHtml(bot.api, id, t(id).yourId(String(ctx.from?.id)));
  }));

  // --- Настройки ---
  bot.command('config', guard(async (ctx, id) => {
    const s = t(id);
    await bot.api.sendMessage(id, s.configTitle, {
      parse_mode: 'HTML',
      reply_markup: kb([
        [btn(s.btnLanguage, 'cfg:lang', 'settings')],
        [btn(s.btnMode, 'cfg:mode', 'lock')],
        [btn(s.btnModel, 'cfg:model', 'brush')],
      ]),
    });
  }));

  bot.callbackQuery('cfg:lang', guard(async (ctx, id) => {
    await ctx.answerCallbackQuery();
    await sendLanguageChooser(id);
  }));
  bot.callbackQuery('cfg:mode', guard(async (ctx, id) => {
    await ctx.answerCallbackQuery();
    await showModeChooser(id);
  }));
  bot.callbackQuery('cfg:model', guard(async (ctx, id) => {
    await ctx.answerCallbackQuery();
    await showModelChooser(id);
  }));

  // --- Сброс / новая сессия ---
  bot.command(['new', 'clear'], guard(async (ctx, id) => {
    await sessions.reset(id);
    await sendHtml(bot.api, id, t(id).newSession);
  }));

  // --- Выбор прошлой сессии (по всем проектам, свежие сверху) ---
  bot.command(['resume', 'sessions'], guard(async (ctx, id) => {
    const list = await listSessions({ limit: 15 });
    list.sort((a, b) => b.lastModified - a.lastModified);
    if (list.length === 0) {
      await sendHtml(bot.api, id, t(id).noSessions);
      return;
    }
    const rows: PremiumButton[][] = list.map((s) => {
      const title = (s.customTitle || s.summary || s.firstPrompt || s.sessionId)
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      const label = `${fmtDate(s.lastModified)} · ${baseName(s.cwd)} · ${title}`;
      return [btn(label.slice(0, 60), `resume:${s.sessionId}`, 'file')];
    });
    await bot.api.sendMessage(id, t(id).sessionsHeader(list.length), {
      parse_mode: 'HTML',
      reply_markup: kb(rows),
    });
  }));

  // --- Статус ---
  bot.command('status', guard(async (ctx, id) => {
    const s = sessions.get(id);
    const tr = t(id);
    await sendHtml(bot.api, id, tr.status(s.sessionId ?? tr.notInit, s.model, s.mode, s.cwd));
  }));

  // --- Режим разрешений ---
  bot.command('mode', guard(async (ctx, id) => {
    const arg = ctx.match?.toString().trim();
    if (arg) {
      if (!PERMISSION_MODES.includes(arg as PermissionMode)) {
        await sendHtml(bot.api, id, t(id).unknownMode(PERMISSION_MODES.join(', ')));
        return;
      }
      await sessions.setMode(id, arg as PermissionMode);
      await sendHtml(bot.api, id, t(id).modeSet(arg));
      return;
    }
    await showModeChooser(id);
  }));

  // --- Модель ---
  bot.command('model', guard(async (ctx, id) => {
    const arg = ctx.match?.toString().trim();
    if (arg) {
      await sessions.get(id).setModel(arg);
      await sendHtml(bot.api, id, t(id).modelSet(arg));
      return;
    }
    await showModelChooser(id);
  }));

  bot.command('models', guard(async (ctx, id) => {
    const models = await sessions.get(id).listModels();
    const text = models.map((m) => `• ${m.displayName} — ${m.value}`).join('\n');
    await sendChunked(bot.api, id, text || t(id).modelsUnavailable);
  }));

  // --- Список нативных слэш-команд Claude ---
  bot.command('commands', guard(async (ctx, id) => {
    const cmds = await sessions.get(id).listCommands();
    const text = cmds
      .map((c) => `/${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} — ${c.description}`)
      .join('\n');
    await sendChunked(bot.api, id, text || t(id).noCommands);
  }));

  bot.command('agents', guard(async (ctx, id) => {
    const agents = await sessions.get(id).listAgents();
    const text = agents.map((a) => `• ${a.name} — ${a.description}`).join('\n');
    await sendChunked(bot.api, id, text || t(id).noAgents);
  }));

  bot.command('mcp', guard(async (ctx, id) => {
    const servers = await sessions.get(id).mcpStatus();
    const text = servers.map((s) => `• ${s.name}: ${s.status}`).join('\n');
    await sendChunked(bot.api, id, text || t(id).noMcp);
  }));

  // --- Прерывание ---
  bot.command('stop', guard(async (ctx, id) => {
    if (!sessions.has(id)) {
      await sendHtml(bot.api, id, t(id).noActiveSession);
      return;
    }
    await sessions.get(id).interrupt();
    await sendHtml(bot.api, id, t(id).interrupted);
  }));

  // --- Callback: возобновление сессии ---
  bot.callbackQuery(/^resume:(.+)$/, guard(async (ctx, id) => {
    const sessionId = ctx.match![1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    const info = await getSessionInfo(sessionId).catch(() => undefined);
    await sessions.reset(id, sessionId, info?.cwd);
    await sendHtml(bot.api, id, t(id).resumed(info?.cwd));
  }));

  // --- Callback: смена модели ---
  bot.callbackQuery(/^model:(.+)$/, guard(async (ctx, id) => {
    const value = ctx.match![1];
    await sessions.get(id).setModel(value);
    await ctx.answerCallbackQuery({ text: value });
    await ctx.editMessageText(t(id).modelSet(value), { parse_mode: 'HTML' });
  }));

  // --- Callback: смена режима ---
  bot.callbackQuery(/^mode:(.+)$/, guard(async (ctx, id) => {
    const mode = ctx.match![1] as PermissionMode;
    await sessions.setMode(id, mode);
    await ctx.answerCallbackQuery({ text: mode });
    await ctx.editMessageText(t(id).modeSet(mode), { parse_mode: 'HTML' });
  }));

  // --- Любой текст (и непойманные слэш-команды) → в Claude ---
  bot.on('message:text', guard(async (ctx, id) => {
    const text = ctx.message?.text;
    if (!text) return;
    await ctx.api.sendChatAction(id, 'typing');
    sessions.get(id).send(text);
  }));

  // --- Фото → Claude (мультимодально) ---
  bot.on('message:photo', guard(async (ctx, id) => {
    const caption = ctx.message?.caption?.trim() || t(id).imagePrompt;
    await ctx.api.sendChatAction(id, 'typing');
    const data = await downloadBase64(ctx);
    sessions.get(id).sendContent([
      { type: 'text', text: caption },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
    ]);
  }));

  // --- Картинка файлом (документом) ---
  bot.on('message:document', guard(async (ctx, id) => {
    const mime = ctx.message?.document?.mime_type ?? '';
    if (!mime.startsWith('image/')) {
      await sendHtml(bot.api, id, t(id).notAnImage);
      return;
    }
    const caption = ctx.message?.caption?.trim() || t(id).imagePrompt;
    await ctx.api.sendChatAction(id, 'typing');
    const data = await downloadBase64(ctx);
    const media = ALLOWED_IMAGE_MIME.has(mime) ? mime : 'image/jpeg';
    sessions.get(id).sendContent([
      { type: 'text', text: caption },
      { type: 'image', source: { type: 'base64', media_type: media, data } },
    ]);
  }));

  // --- Прочие медиа без поддержки контента ---
  bot.on('message', guard(async (ctx, id) => {
    await sendHtml(bot.api, id, t(id).mediaFallback);
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
