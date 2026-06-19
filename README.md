# claude-code-tg

[Русский](#claude-code-tg) | [English](#english)

Управление Claude Code из Telegram. Самостоятельный бот на официальном
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
поэтому он запускает настоящий Claude Code в headless-режиме за Telegram-чатом.

Поддерживает все нативные слэш-команды Claude Code, все режимы разрешений,
выбор и возобновление сессий, мультимодальный ввод (фото), стриминг ответов с
богатым Markdown-форматированием и доступ только для whitelist из Telegram ID.

> Это не плагин маркетплейса Claude Code. Это самодостаточный бот на Node.js,
> который ставится как CLI-утилита и запускается как процесс.

## Возможности

- Все нативные слэш-команды Claude Code. Пиши `/code-review`, `/init`,
  `/security-review`, `/compact`, кастомные команды и скиллы как есть — они
  выполняются нативно. Команды управления сессией (`/new`, `/clear`,
  `/resume`, `/model`, `/mode`) бот реализует сам через SDK.
- Все режимы разрешений: `default`, `acceptEdits`, `plan`, `bypassPermissions`,
  `dontAsk`, `auto`. Переключаются прямо из чата.
- Запросы разрешений — inline-кнопками. В режимах, где нужно подтверждение,
  каждый запрос на запись/Bash прилетает кнопками Разрешить / Всегда / Отклонить.
- Выбор и возобновление сессий по всем проектам (`/resume`, `/sessions`),
  с возобновлением в родной рабочей папке каждой сессии.
- Фото и картинки-файлы. Claude мультимодальный и видит присланные изображения.
- Богатые ответы. Markdown от Claude рендерится нативно (заголовки, код-блоки,
  списки, таблицы, цитаты) через Rich Messages из Telegram Bot API 10.1, до
  32768 символов.
- Стриминг. Ответ печатается в реальном времени по мере генерации, затем
  сохраняется.
- Двуязычный интерфейс (английский / русский), выбирается при первом запуске и
  меняется в любой момент через `/config`.
- Безопасность. Доступ только для whitelist из Telegram ID (fail-closed: пустой
  список не пускает никого).

## Как это устроено

```
Telegram  -->  grammY  -->  ClaudeSession (streaming input)  -->  query() из Agent SDK  -->  Claude Code
                 ^                                    |
                 +---- inline-кнопки Разрешить/Отклонить <--+ canUseTool (запрос разрешения)
```

Одна долгоживущая сессия Claude на каждый Telegram-чат. Сообщения уходят в
Claude по мере поступления; ответы стримятся обратно. Запросы разрешений
(`canUseTool`) превращаются в inline-кнопки.

## Требования

- Node.js 20 или новее (проверено на v26).
- Установленный и авторизованный Claude Code (`claude`). SDK запускает тот же
  бинарь и использует ту же авторизацию (подписка Claude через OAuth / macOS
  Keychain или `ANTHROPIC_API_KEY`).
- Токен бота от [@BotFather](https://t.me/BotFather).
- Для премиум-эмодзи в интерфейсе у владельца бота должен быть Telegram Premium
  (без него бот работает, эмодзи отображаются обычными).

## Установка

Ставится один раз как глобальная CLI-утилита. Это даёт команду `claude-code-tg`,
запускаемую из любой папки.

Из локального клона:

```bash
git clone https://github.com/ichmagmaus111/claude-code-tg.git
cd claude-code-tg
npm install -g .
```

Напрямую с GitHub:

```bash
npm install -g git+https://github.com/ichmagmaus111/claude-code-tg.git
```

Проверка:

```bash
claude-code-tg --version
claude-code-tg --help
```

Для разработки (запуск из клона без глобальной установки):

```bash
npm install
npm run dev          # tsx watch, авто-перезагрузка
```

## Конфигурация

Конфиг читается из двух `.env` в таком порядке приоритета:

1. `.env` в текущей рабочей папке (высший приоритет).
2. `~/.config/claude-code-tg/.env` (глобальный; удобно для глобально
   установленной утилиты, чтобы запускать откуда угодно).

Пустые значения в локальном `.env` игнорируются, чтобы не затирать глобальный
конфиг.

Создать глобальный конфиг:

```bash
mkdir -p ~/.config/claude-code-tg
$EDITOR ~/.config/claude-code-tg/.env
```

| Переменная | Обязательна | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | да | Токен бота от @BotFather. |
| `ALLOWED_USER_IDS` | да | Через запятую — Telegram ID, которым разрешён доступ. Свой узнаешь у [@userinfobot](https://t.me/userinfobot) или командой `/id`. Пустой список не пускает никого. |
| `WORKING_DIR` | рекомендуется | Каталог проекта, в котором работает Claude (его `cwd`). По умолчанию — текущая папка. |
| `ANTHROPIC_API_KEY` | опционально | Нужен, только если не используешь логин по подписке Claude. |
| `DEFAULT_MODEL` | опционально | `opus` / `sonnet` / `haiku` или полный id модели. |
| `DEFAULT_PERMISSION_MODE` | опционально | Одно из `default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`, `auto`. По умолчанию `default`. |

Минимальный пример (`~/.config/claude-code-tg/.env`):

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
ALLOWED_USER_IDS=111111111
WORKING_DIR=/Users/me/projects/my-project
DEFAULT_PERMISSION_MODE=default
```

Полный шаблон — в [`.env.example`](.env.example).

### Первый запуск и язык

При первом обращении бот сначала просит выбрать язык (английский или русский).
Выбор сохраняется по чату в `.claude-bot-settings.json` и меняется в любой
момент через `/config`. Локализуются собственные сообщения бота; ответы Claude
приходят на том языке, на котором отвечает Claude.

## Запуск

```bash
claude-code-tg
```

В логе появится `Bot @yourbot started`. Открой бота в Telegram и напиши
сообщение.

## Команды

| Команда | Действие |
|---|---|
| *(любой текст)* | Уходит в Claude как промпт. |
| *(фото / картинка-файл)* | Уходит в Claude как изображение (подпись становится промптом). |
| `/code-review`, `/init`, ... | Любая слэш-команда Claude. Пишешь как есть, выполняется нативно. |
| `/config` | Настройки: язык, режим разрешений, модель. |
| `/new`, `/clear` | Новая сессия (сброс контекста). |
| `/resume`, `/sessions` | Выбрать прошлую сессию для возобновления. |
| `/status` | Текущая сессия, модель, режим, каталог. |
| `/mode [режим]` | Сменить режим разрешений (кнопки без аргумента). |
| `/model [имя]` | Сменить модель (кнопки без аргумента). |
| `/models` | Список доступных моделей. |
| `/commands` | Нативные слэш-команды Claude текущей сессии. |
| `/agents` | Список доступных сабагентов. |
| `/mcp` | Статус MCP-серверов. |
| `/stop` | Прервать текущий ход. |
| `/id` | Показать твой Telegram ID. |
| `/help` | Справка. |

## Режимы разрешений

- `default` — спрашивает на опасные операции (запись/Bash) кнопками
  Разрешить/Отклонить.
- `acceptEdits` — авто-приём правок файлов; на остальное всё равно спрашивает.
- `plan` — только планирование, без выполнения инструментов.
- `bypassPermissions` — выполняет всё без вопросов. Включай осознанно.
- `dontAsk` — не спрашивает; отклоняет всё, что не разрешено заранее.
- `auto` — решение принимает классификатор-модель.

## Безопасность

- Whitelist по Telegram ID — единственное, что даёт управление. Даже при утечке
  токена пользователь, чьего ID нет в `ALLOWED_USER_IDS`, получит «Доступ
  запрещён». С пустым whitelist бот не отвечает никому (fail-closed).
- `bypassPermissions` выполняет всё без подтверждения. Любой авторизованный
  пользователь получает полный доступ Claude Code (включая Bash) к `WORKING_DIR`.
  Запускай бота на машине и в каталоге, которым доверяешь.
- Секреты (`.env`) и состояние по чатам (`.claude-bot-sessions.json`,
  `.claude-bot-settings.json`) в `.gitignore`. Не коммить свой токен.

## Постоянная работа (опционально)

По умолчанию бот работает как процесс на переднем плане и останавливается при
закрытии терминала. Чтобы держать его включённым:

- Проще всего: запускать `claude-code-tg` внутри мультиплексора терминала
  (tmux/screen) или через `nohup`.
- Как LaunchAgent на macOS: учти, что процессы, запущенные launchd, не имеют
  доступа к защищённым TCC-папкам (`~/Desktop`, `~/Documents`, `~/Downloads`)
  без Full Disk Access. Если `WORKING_DIR` лежит в одной из них — либо перенеси
  его в незащищённый путь (например `~/projects`), либо выдай Full Disk Access
  для `node` в Системных настройках → Конфиденциальность и безопасность.

Опрашивать один токен бота может только один инстанс одновременно; второй упадёт
с ошибкой Telegram 409 (Conflict). Убедись, что бот не запущен дважды.

## Структура проекта

```
src/
  index.ts          точка входа, флаги CLI, запуск/останов
  config.ts         загрузка и валидация .env (локальный + глобальный)
  i18n.ts           все пользовательские строки (en / ru)
  settings.ts       настройки по чату (язык) с персистом
  bot.ts            grammY: auth, гейт языка, команды, колбэки
  sessionManager.ts чат -> сессия Claude, рендеринг, стриминг, персист
  claudeSession.ts  обёртка над query() (streaming input, управляющие методы)
  permissions.ts    canUseTool -> inline-кнопки Разрешить/Отклонить
  queue.ts          push-очередь для streaming input SDK
  render.ts         лимиты Telegram, rich messages, черновики, описания инструментов
  emoji.ts          хелперы премиум-эмодзи
```

## Разработка

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run build        # компиляция в dist/
npm run dev          # запуск с авто-перезагрузкой
```

## Лицензия

MIT. См. [LICENSE](LICENSE).

---

# English

[Русский](#claude-code-tg) | [English](#english)

Control Claude Code from Telegram. A standalone bot built on the official
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
so it runs real Claude Code in headless mode behind a Telegram chat.

It supports every native Claude Code slash command, all permission modes,
session selection and resume, multimodal input (photos), live-streamed replies
with rich Markdown formatting, and access restricted to a whitelist of Telegram
user IDs.

> Not a Claude Code marketplace plugin. It is a self-contained Node.js bot you
> install as a CLI tool and run as a process.

## Features

- All native Claude Code slash commands. Type `/code-review`, `/init`,
  `/security-review`, `/compact`, custom commands and skills as-is and they run
  natively. Session-control commands (`/new`, `/clear`, `/resume`, `/model`,
  `/mode`) are reimplemented by the bot via the SDK.
- All permission modes: `default`, `acceptEdits`, `plan`, `bypassPermissions`,
  `dontAsk`, `auto`. Switchable from the chat.
- Permission prompts as inline buttons. In modes that require approval, each
  write/Bash request arrives as Allow / Always / Deny buttons.
- Session selection and resume across all projects (`/resume`, `/sessions`),
  resuming in each session's own working directory.
- Photos and image files. Claude is multimodal and sees the images you send.
- Rich replies. Claude's Markdown output is rendered natively (headings, code
  blocks, lists, tables, quotes) using Telegram Bot API 10.1 Rich Messages, up
  to 32768 characters.
- Streaming. Replies are streamed live as Claude generates them, then persisted.
- Bilingual UI (English / Russian), chosen on first launch and changeable any
  time via `/config`.
- Security. Access is restricted to a whitelist of Telegram user IDs
  (fail-closed: an empty list rejects everyone).

## How it works

```
Telegram  -->  grammY  -->  ClaudeSession (streaming input)  -->  query() from the Agent SDK  -->  Claude Code
                 ^                                    |
                 +---- inline Allow / Deny buttons <--+ canUseTool (permission request)
```

One long-lived Claude session per Telegram chat. Messages are fed to Claude as
they arrive; replies stream back. Permission requests (`canUseTool`) become
inline buttons.

## Requirements

- Node.js 20 or newer (tested on v26).
- Claude Code (`claude`) installed and authenticated. The SDK launches the same
  binary and reuses the same authentication (Claude subscription via OAuth /
  macOS Keychain, or an `ANTHROPIC_API_KEY`).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- A Telegram account with Premium for the bot owner is required for the premium
  custom-emoji UI to render (the bot works without it; emoji fall back to
  standard ones).

## Installation

Install it once as a global CLI tool. This provides the `claude-code-tg`
command, runnable from any directory.

From a local clone:

```bash
git clone https://github.com/ichmagmaus111/claude-code-tg.git
cd claude-code-tg
npm install -g .
```

Directly from GitHub:

```bash
npm install -g git+https://github.com/ichmagmaus111/claude-code-tg.git
```

Verify:

```bash
claude-code-tg --version
claude-code-tg --help
```

For development (run from the cloned directory without installing globally):

```bash
npm install
npm run dev          # tsx watch, auto-reload
```

## Configuration

Configuration is read from two `.env` locations, in this order of precedence:

1. `.env` in the current working directory (highest precedence).
2. `~/.config/claude-code-tg/.env` (global; convenient for the globally
   installed CLI, so you can run it from anywhere).

Empty values in the local `.env` are ignored so they do not shadow the global
config.

Create the global config:

```bash
mkdir -p ~/.config/claude-code-tg
$EDITOR ~/.config/claude-code-tg/.env
```

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | Bot token from @BotFather. |
| `ALLOWED_USER_IDS` | yes | Comma-separated Telegram user IDs allowed to use the bot. Find yours via [@userinfobot](https://t.me/userinfobot) or the `/id` command. An empty list rejects everyone. |
| `WORKING_DIR` | recommended | Project directory Claude operates in (its `cwd`). Defaults to the current directory if unset. |
| `ANTHROPIC_API_KEY` | optional | Only needed if you are not using a Claude subscription login. |
| `DEFAULT_MODEL` | optional | `opus` / `sonnet` / `haiku` or a full model id. |
| `DEFAULT_PERMISSION_MODE` | optional | One of `default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`, `auto`. Defaults to `default`. |

Minimal example (`~/.config/claude-code-tg/.env`):

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
ALLOWED_USER_IDS=111111111
WORKING_DIR=/Users/me/projects/my-project
DEFAULT_PERMISSION_MODE=default
```

See [`.env.example`](.env.example) for the full template.

### First launch and language

The first time a user interacts with the bot it asks them to pick a language
(English or Russian) before anything else. The choice is stored per chat in
`.claude-bot-settings.json` and can be changed any time via `/config`. The
bot's own messages are localized; Claude's replies come in whatever language
Claude responds with.

## Running

```bash
claude-code-tg
```

You should see `Bot @yourbot started`. Open the bot in Telegram and send a
message.

## Commands

| Command | Action |
|---|---|
| *(any text)* | Sent to Claude as a prompt. |
| *(photo / image file)* | Sent to Claude as an image (optional caption becomes the prompt). |
| `/code-review`, `/init`, ... | Any Claude slash command. Typed as-is, runs natively. |
| `/config` | Settings: language, permission mode, model. |
| `/new`, `/clear` | New session (reset context). |
| `/resume`, `/sessions` | Pick a past session to resume. |
| `/status` | Current session, model, mode, directory. |
| `/mode [mode]` | Change permission mode (buttons if no argument). |
| `/model [name]` | Change model (buttons if no argument). |
| `/models` | List available models. |
| `/commands` | List the session's native Claude slash commands. |
| `/agents` | List available subagents. |
| `/mcp` | MCP server status. |
| `/stop` | Interrupt the current turn. |
| `/id` | Show your Telegram ID. |
| `/help` | Help. |

## Permission modes

- `default` - prompts for dangerous operations (write/Bash) via Allow/Deny
  buttons.
- `acceptEdits` - auto-accepts file edits; still prompts for other actions.
- `plan` - planning only, no tool execution.
- `bypassPermissions` - runs everything without asking. Use deliberately.
- `dontAsk` - does not prompt; denies anything not pre-approved.
- `auto` - a model classifier decides whether to approve or deny.

## Security

- Whitelist by Telegram user ID is the only thing that grants control. Even if
  the token leaks, a user whose ID is not in `ALLOWED_USER_IDS` gets "Access
  denied". With an empty whitelist the bot answers no one (fail-closed).
- `bypassPermissions` executes everything without confirmation. Any authorized
  user gets full Claude Code access (including Bash) to `WORKING_DIR`. Run the
  bot on a machine and in a directory you trust.
- Secrets (`.env`) and per-chat state (`.claude-bot-sessions.json`,
  `.claude-bot-settings.json`) are gitignored. Do not commit your token.

## Always-on (optional)

By default the bot runs as a foreground process and stops when you close the
terminal. To keep it running:

- Simplest: run `claude-code-tg` inside a terminal multiplexer (tmux/screen) or
  with `nohup`.
- As a macOS LaunchAgent: note that launchd-spawned processes cannot read
  TCC-protected folders (`~/Desktop`, `~/Documents`, `~/Downloads`) without
  Full Disk Access. If your `WORKING_DIR` is under one of those, either move it
  to an unprotected path (for example `~/projects`) or grant Full Disk Access
  to `node` in System Settings > Privacy & Security.

Only one instance may poll a given bot token at a time; a second instance fails
with Telegram error 409 (Conflict). Make sure you are not running the bot twice.

## Project structure

```
src/
  index.ts          entry point, CLI flags, start/stop
  config.ts         load and validate .env (local + global)
  i18n.ts           all user-facing strings (en / ru)
  settings.ts       per-chat settings (language) with persistence
  bot.ts            grammY: auth, language gate, commands, callbacks
  sessionManager.ts chat -> Claude session, rendering, streaming, persistence
  claudeSession.ts  wrapper around query() (streaming input, control methods)
  permissions.ts    canUseTool -> inline Allow / Deny buttons
  queue.ts          push queue feeding the SDK streaming input
  render.ts         Telegram limits, rich messages, drafts, tool summaries
  emoji.ts          premium custom-emoji helpers
```

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run build        # compile to dist/
npm run dev          # run with auto-reload
```

## License

MIT. See [LICENSE](LICENSE).
