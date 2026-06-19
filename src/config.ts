import { config as dotenvConfig, parse as dotenvParse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

/** Глобальный конфиг для случая, когда утилита установлена через `npm i -g`. */
export const GLOBAL_CONFIG = join(homedir(), '.config', 'claude-code-tg', '.env');

// Сначала грузим глобальный конфиг (низший приоритет)...
dotenvConfig({ path: GLOBAL_CONFIG });
// ...затем накрываем НЕпустыми значениями из .env текущей папки (высший приоритет).
// Пустые значения локального .env намеренно игнорируем, чтобы они не затирали глобальные.
try {
  const local = dotenvParse(readFileSync(join(process.cwd(), '.env')));
  for (const [key, value] of Object.entries(local)) {
    if (value.trim() !== '') process.env[key] = value;
  }
} catch {
  /* локального .env нет — это нормально */
}

export const CONFIG_HINT = `Конфиг ищется в .env (текущая папка) и в ${GLOBAL_CONFIG}.
Минимум: TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, WORKING_DIR.`;

const VALID_MODES: PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
];

export interface Config {
  botToken: string;
  allowedUserIds: Set<number>;
  workingDir: string;
  defaultModel: string | undefined;
  defaultMode: PermissionMode;
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Не задана обязательная переменная окружения ${name}.\n${CONFIG_HINT}`,
    );
  }
  return v;
}

export function loadConfig(): Config {
  const botToken = required('TELEGRAM_BOT_TOKEN');

  const allowedUserIds = new Set(
    (process.env.ALLOWED_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) {
          throw new Error(`ALLOWED_USER_IDS содержит нечисловой ID: "${s}"`);
        }
        return n;
      }),
  );

  if (allowedUserIds.size === 0) {
    // fail-closed: без whitelist бот никому не отвечает
    console.warn(
      '⚠️  ALLOWED_USER_IDS пуст — бот будет отклонять ВСЕХ. Добавь свой Telegram ID.',
    );
  }

  const workingDir = resolve(process.env.WORKING_DIR?.trim() || process.cwd());

  const rawMode = (process.env.DEFAULT_PERMISSION_MODE?.trim() ||
    'default') as PermissionMode;
  if (!VALID_MODES.includes(rawMode)) {
    throw new Error(
      `DEFAULT_PERMISSION_MODE="${rawMode}" недопустим. Допустимо: ${VALID_MODES.join(', ')}`,
    );
  }

  return {
    botToken,
    allowedUserIds,
    workingDir,
    defaultModel: process.env.DEFAULT_MODEL?.trim() || undefined,
    defaultMode: rawMode,
  };
}

export const PERMISSION_MODES = VALID_MODES;
