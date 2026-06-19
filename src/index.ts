#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { GrammyError } from 'grammy';
import { loadConfig, CONFIG_HINT } from './config.js';
import { buildBot, registerCommandMenu } from './bot.js';
import { serviceCommand } from './service.js';

function pkgVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USAGE = `claude-code-tg — управление Claude Code из Telegram

Использование:
  claude-code-tg                 запустить бота (конфиг из .env)
  claude-code-tg install-service включить автозапуск (macOS launchd)
  claude-code-tg uninstall-service  отключить автозапуск
  claude-code-tg --version       версия
  claude-code-tg --help          эта справка

${CONFIG_HINT}`;

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--version' || arg === '-v') {
    console.log(pkgVersion());
    return;
  }
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    return;
  }
  if (arg === 'install-service') {
    serviceCommand('install');
    return;
  }
  if (arg === 'uninstall-service') {
    serviceCommand('uninstall');
    return;
  }

  const config = loadConfig();
  const { bot, sessions } = buildBot(config);

  await registerCommandMenu(bot).catch((err) => {
    console.error('Не удалось зарегистрировать меню команд:', err);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nПолучен ${signal}, завершаю…`);
    await sessions.closeAll().catch(() => {});
    await bot.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('🤖 Запускаю Telegram-бота Claude Code…');
  console.log(`   Каталог проекта: ${config.workingDir}`);
  console.log(`   Разрешённых пользователей: ${config.allowedUserIds.size}`);
  console.log(`   Режим по умолчанию: ${config.defaultMode}`);

  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: (info) => console.log(`✅ Бот @${info.username} запущен.`),
    });
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 409) {
      console.error(
        'Конфликт 409: этот токен уже опрашивает другой инстанс бота. ' +
          'Останови второй экземпляр (или сними автозапуск) и запусти заново.',
      );
    } else {
      console.error('Polling остановлен:', err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
