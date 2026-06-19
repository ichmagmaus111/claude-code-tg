import { tg, escapeHtml } from './emoji.js';

export type Lang = 'ru' | 'en';
export const LANGS: Lang[] = ['ru', 'en'];
export const DEFAULT_LANG: Lang = 'ru';

/** Все пользовательские строки бота. Ответы самого Claude не локализуются. */
export interface Strings {
  langName: string;
  help: string;
  chooseLanguage: string;
  languageSet: string;
  // config
  configTitle: string;
  btnLanguage: string;
  btnMode: string;
  btnModel: string;
  // auth / общие
  accessDenied: (id: string) => string;
  yourId: (id: string) => string;
  // сессии
  newSession: string;
  noSessions: string;
  sessionsHeader: (n: number) => string;
  resumed: (cwd?: string) => string;
  // статус
  statusTitle: string;
  status: (sid: string, model: string, mode: string, cwd: string) => string;
  notInit: string;
  // режимы
  unknownMode: (modes: string) => string;
  modeSet: (m: string) => string;
  chooseMode: string;
  modeDesc: Record<string, string>;
  // модели
  modelSet: (m: string) => string;
  modelsUnavailable: string;
  chooseModel: string;
  // списки
  noCommands: string;
  noAgents: string;
  noMcp: string;
  // прерывание
  noActiveSession: string;
  interrupted: string;
  // медиа
  notAnImage: string;
  mediaFallback: string;
  imagePrompt: string;
  // разрешения
  permTitle: string;
  permTool: (name: string) => string;
  btnAllow: string;
  btnAlways: string;
  btnDeny: string;
  toastAllowed: string;
  toastAlways: string;
  toastDenied: string;
  decAllowed: string;
  decAlways: string;
  decDenied: string;
  denyReason: string;
  permTimeout: string;
  sessionRestarted: string;
  staleRequest: string;
  // результат
  turnError: (subtype: string) => string;
  // меню команд (язык клиента Telegram)
  cmdMenu: { command: string; description: string }[];
}

const RU: Strings = {
  langName: 'Русский',
  help: `${tg('bot')} <b>Claude Code в Telegram</b>

Просто пиши сообщение — оно уйдёт в Claude. Можно слать ${tg('media')} фото и картинки-файлы — Claude их видит. Слэш-команды Claude (/code-review, /init, /security-review, /compact, кастомные, скиллы) тоже пиши как есть — выполнятся нативно.

<b>${tg('settings')} Управление ботом:</b>
/config — настройки (язык, режим, модель)
/new, /clear — новая сессия (сброс контекста)
/resume, /sessions — выбрать прошлую сессию
/status — текущая сессия, модель, режим
/mode [режим] — режим разрешений
/model [имя] — модель
/models — список моделей
/commands — нативные слэш-команды Claude
/agents — сабагенты
/mcp — статус MCP-серверов
/stop — прервать текущий ход
/id — твой Telegram ID
/help — справка

<b>${tg('lock')} Режимы разрешений:</b>
default — спрашивать на опасные операции
acceptEdits — авто-приём правок файлов
plan — только планирование
bypassPermissions — выполнять всё без вопросов
dontAsk — не спрашивать, но и не разрешать сверх правил
auto — модель сама решает

Запросы на запись/Bash в режимах default/plan прилетают кнопками ${tg('check')}/${tg('cross')}.`,
  chooseLanguage: `${tg('settings')} Выбери язык / Choose your language:`,
  languageSet: `${tg('check')} Язык: Русский`,
  configTitle: `${tg('settings')} <b>Настройки бота</b>`,
  btnLanguage: 'Язык',
  btnMode: 'Режим разрешений',
  btnModel: 'Модель',
  accessDenied: (id) =>
    `${tg('denied')} <b>Доступ запрещён.</b> Твой ID: ${escapeHtml(id)}\nДобавь его в ALLOWED_USER_IDS.`,
  yourId: (id) => `${tg('info')} Твой Telegram ID: ${escapeHtml(id)}`,
  newSession: `${tg('reload')} Создаю новую сессию. Напиши задачу.`,
  noSessions: `${tg('file')} Прошлых сессий не найдено.`,
  sessionsHeader: (n) => `${tg('file')} Последние сессии (${n}) — выбери для возобновления:`,
  resumed: (cwd) =>
    `${tg('reload')} Сессия возобновлена${cwd ? ` (папка: ${escapeHtml(cwd)})` : ''}. Пиши, чтобы продолжить.`,
  statusTitle: 'Статус',
  status: (sid, model, mode, cwd) =>
    [
      `${tg('stats')} <b>Статус</b>`,
      `Сессия: ${escapeHtml(sid)}`,
      `Модель: ${escapeHtml(model)}`,
      `Режим: ${escapeHtml(mode)}`,
      `Каталог: ${escapeHtml(cwd)}`,
    ].join('\n'),
  notInit: '(ещё не инициализирована)',
  unknownMode: (modes) => `${tg('cross')} Неизвестный режим. Допустимо: ${escapeHtml(modes)}`,
  modeSet: (m) => `${tg('settings')} Режим: ${escapeHtml(m)}`,
  chooseMode: `${tg('settings')} Выбери режим разрешений:`,
  modeDesc: {
    default: 'спрашивать',
    acceptEdits: 'авто-правки',
    plan: 'планирование',
    bypassPermissions: 'без вопросов',
    dontAsk: 'не спрашивать',
    auto: 'авто (модель)',
  },
  modelSet: (m) => `${tg('brush')} Модель: ${escapeHtml(m)}`,
  modelsUnavailable: `${tg('brush')} Список моделей недоступен. Задай явно: /model имя`,
  chooseModel: `${tg('brush')} Выбери модель:`,
  noCommands: 'Команды не найдены.',
  noAgents: 'Сабагенты не найдены.',
  noMcp: 'MCP-серверы не настроены.',
  noActiveSession: `${tg('info')} Нет активной сессии.`,
  interrupted: `${tg('cross')} Прервано.`,
  notAnImage: `${tg('info')} Это не картинка. Я понимаю текст, команды и изображения.`,
  mediaFallback: `${tg('info')} Я понимаю текст, команды, фото и изображения. (Голосовые пока не поддерживаются.)`,
  imagePrompt: 'Посмотри на это изображение.',
  permTitle: 'Запрос разрешения',
  permTool: (name) => `Инструмент: ${escapeHtml(name)}`,
  btnAllow: 'Разрешить',
  btnAlways: 'Всегда',
  btnDeny: 'Отклонить',
  toastAllowed: 'Разрешено',
  toastAlways: 'Разрешено (всегда)',
  toastDenied: 'Отклонено',
  decAllowed: 'Разрешено',
  decAlways: 'Разрешено (всегда)',
  decDenied: 'Отклонено',
  denyReason: 'Пользователь отклонил запрос в Telegram.',
  permTimeout: 'Время ожидания подтверждения истекло (10 мин).',
  sessionRestarted: 'Сессия перезапущена.',
  staleRequest: 'Запрос уже неактуален.',
  turnError: (subtype) => `${tg('cross')} Ход завершён с ошибкой: ${escapeHtml(subtype)}`,
  cmdMenu: [
    { command: 'config', description: 'Настройки' },
    { command: 'new', description: 'Новая сессия' },
    { command: 'resume', description: 'Выбрать прошлую сессию' },
    { command: 'status', description: 'Текущая сессия и настройки' },
    { command: 'mode', description: 'Режим разрешений' },
    { command: 'model', description: 'Выбор модели' },
    { command: 'commands', description: 'Нативные слэш-команды Claude' },
    { command: 'stop', description: 'Прервать ход' },
    { command: 'help', description: 'Справка' },
  ],
};

const EN: Strings = {
  langName: 'English',
  help: `${tg('bot')} <b>Claude Code in Telegram</b>

Just type a message — it goes to Claude. You can send ${tg('media')} photos and image files — Claude sees them. Claude slash commands (/code-review, /init, /security-review, /compact, custom ones, skills) work too — type them as-is and they run natively.

<b>${tg('settings')} Bot controls:</b>
/config — settings (language, mode, model)
/new, /clear — new session (reset context)
/resume, /sessions — pick a past session
/status — current session, model, mode
/mode [mode] — permission mode
/model [name] — model
/models — list of models
/commands — native Claude slash commands
/agents — subagents
/mcp — MCP server status
/stop — interrupt current turn
/id — your Telegram ID
/help — this help

<b>${tg('lock')} Permission modes:</b>
default — ask on dangerous operations
acceptEdits — auto-accept file edits
plan — planning only
bypassPermissions — run everything without asking
dontAsk — don't ask, deny beyond rules
auto — model decides

Write/Bash requests in default/plan modes arrive as ${tg('check')}/${tg('cross')} buttons.`,
  chooseLanguage: `${tg('settings')} Choose your language / Выбери язык:`,
  languageSet: `${tg('check')} Language: English`,
  configTitle: `${tg('settings')} <b>Bot settings</b>`,
  btnLanguage: 'Language',
  btnMode: 'Permission mode',
  btnModel: 'Model',
  accessDenied: (id) =>
    `${tg('denied')} <b>Access denied.</b> Your ID: ${escapeHtml(id)}\nAdd it to ALLOWED_USER_IDS.`,
  yourId: (id) => `${tg('info')} Your Telegram ID: ${escapeHtml(id)}`,
  newSession: `${tg('reload')} New session created. Send your task.`,
  noSessions: `${tg('file')} No past sessions found.`,
  sessionsHeader: (n) => `${tg('file')} Recent sessions (${n}) — pick one to resume:`,
  resumed: (cwd) =>
    `${tg('reload')} Session resumed${cwd ? ` (dir: ${escapeHtml(cwd)})` : ''}. Send a message to continue.`,
  statusTitle: 'Status',
  status: (sid, model, mode, cwd) =>
    [
      `${tg('stats')} <b>Status</b>`,
      `Session: ${escapeHtml(sid)}`,
      `Model: ${escapeHtml(model)}`,
      `Mode: ${escapeHtml(mode)}`,
      `Directory: ${escapeHtml(cwd)}`,
    ].join('\n'),
  notInit: '(not initialized yet)',
  unknownMode: (modes) => `${tg('cross')} Unknown mode. Allowed: ${escapeHtml(modes)}`,
  modeSet: (m) => `${tg('settings')} Mode: ${escapeHtml(m)}`,
  chooseMode: `${tg('settings')} Choose permission mode:`,
  modeDesc: {
    default: 'ask',
    acceptEdits: 'auto-edits',
    plan: 'planning',
    bypassPermissions: 'no prompts',
    dontAsk: "don't ask",
    auto: 'auto (model)',
  },
  modelSet: (m) => `${tg('brush')} Model: ${escapeHtml(m)}`,
  modelsUnavailable: `${tg('brush')} Model list unavailable. Set it explicitly: /model name`,
  chooseModel: `${tg('brush')} Choose model:`,
  noCommands: 'No commands found.',
  noAgents: 'No subagents found.',
  noMcp: 'No MCP servers configured.',
  noActiveSession: `${tg('info')} No active session.`,
  interrupted: `${tg('cross')} Interrupted.`,
  notAnImage: `${tg('info')} That's not an image. I understand text, commands and images.`,
  mediaFallback: `${tg('info')} I understand text, commands, photos and images. (Voice messages are not supported yet.)`,
  imagePrompt: 'Look at this image.',
  permTitle: 'Permission request',
  permTool: (name) => `Tool: ${escapeHtml(name)}`,
  btnAllow: 'Allow',
  btnAlways: 'Always',
  btnDeny: 'Deny',
  toastAllowed: 'Allowed',
  toastAlways: 'Allowed (always)',
  toastDenied: 'Denied',
  decAllowed: 'Allowed',
  decAlways: 'Allowed (always)',
  decDenied: 'Denied',
  denyReason: 'The user denied the request in Telegram.',
  permTimeout: 'Confirmation timed out (10 min).',
  sessionRestarted: 'Session restarted.',
  staleRequest: 'Request is no longer valid.',
  turnError: (subtype) => `${tg('cross')} Turn finished with error: ${escapeHtml(subtype)}`,
  cmdMenu: [
    { command: 'config', description: 'Settings' },
    { command: 'new', description: 'New session' },
    { command: 'resume', description: 'Pick a past session' },
    { command: 'status', description: 'Current session and settings' },
    { command: 'mode', description: 'Permission mode' },
    { command: 'model', description: 'Choose model' },
    { command: 'commands', description: 'Native Claude slash commands' },
    { command: 'stop', description: 'Interrupt turn' },
    { command: 'help', description: 'Help' },
  ],
};

const DICTS: Record<Lang, Strings> = { ru: RU, en: EN };

/** Возвращает набор строк для языка. */
export function S(lang: Lang): Strings {
  return DICTS[lang] ?? RU;
}
