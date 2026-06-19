import type { Api } from 'grammy';

const TELEGRAM_MAX = 4096;
const CHUNK = 3800; // запас под префиксы/эмодзи

/** Разбивает длинный текст на части <= CHUNK, по возможности по границам строк. */
export function chunkText(text: string, size = CHUNK): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size; // нет удобного переноса — режем жёстко
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

/**
 * Отправляет текст в чат без parse_mode (plain text) — это самый надёжный путь:
 * вывод Claude содержит произвольный markdown/код, и любой parse_mode регулярно
 * ломается на "can't parse entities". Markdown показывается как есть, читаемо.
 */
export async function sendChunked(
  api: Api,
  chatId: number,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  for (const part of chunkText(trimmed)) {
    await api.sendMessage(chatId, part, { link_preview_options: { is_disabled: true } });
  }
}

/**
 * Отправляет короткое «служебное» сообщение бота в HTML (для премиум-эмодзи).
 * Предназначено для собственных сообщений бота — НЕ для ответов Claude
 * (те уходят plain-текстом через {@link sendChunked}). Разбиение — только по
 * строкам, чтобы не разорвать HTML-тег пополам.
 */
export async function sendHtml(
  api: Api,
  chatId: number,
  html: string,
): Promise<void> {
  const trimmed = html.trim();
  if (!trimmed) return;
  const parts =
    trimmed.length <= TELEGRAM_MAX ? [trimmed] : splitByLines(trimmed, CHUNK);
  for (const part of parts) {
    await api.sendMessage(chatId, part, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
}

function splitByLines(text: string, size: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > size) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** Лимит текста Rich Message (Bot API 10.1) — на порядок больше обычного 4096. */
export const RICH_MAX = 32000;

/**
 * Отправляет markdown как Rich Message (Bot API 10.1, sendRichMessage) — нативный
 * рендер заголовков, код-блоков, списков, таблиц и т.п. Метод свежий и ещё не
 * типизирован в grammy, поэтому дёргаем HTTP-эндпоинт напрямую.
 * Возвращает false при любой ошибке — чтобы вызывающий мог упасть на plain-текст.
 */
export async function sendRichMarkdown(
  token: string,
  chatId: number,
  markdown: string,
): Promise<boolean> {
  const trimmed = markdown.trim();
  if (!trimmed) return true;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, rich_message: { markdown: trimmed } }),
    });
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Стримит частичный ответ как эфемерный черновик (Bot API 10.1, sendRichMessageDraft).
 * Обновления с одним draft_id анимируются. Best-effort: ошибки гасим (false).
 */
export async function sendRichDraft(
  token: string,
  chatId: number,
  draftId: number,
  markdown: string,
): Promise<boolean> {
  const trimmed = markdown.trim();
  if (!trimmed) return true;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessageDraft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, draft_id: draftId, rich_message: { markdown: trimmed } }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

/** Короткое человекочитаемое описание вызова инструмента для уведомления в чат. */
export function summarizeToolUse(name: string, input: Record<string, unknown>): string {
  const get = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  let detail: string | undefined;
  switch (name) {
    case 'Bash':
      detail = get('command');
      break;
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      detail = get('file_path');
      break;
    case 'Glob':
      detail = get('pattern');
      break;
    case 'Grep':
      detail = [get('pattern'), get('path')].filter(Boolean).join('  •  ');
      break;
    case 'Task':
    case 'Agent':
      detail = get('description') ?? get('subagent_type');
      break;
    case 'WebFetch':
    case 'WebSearch':
      detail = get('url') ?? get('query');
      break;
    default:
      detail = undefined;
  }
  if (!detail) {
    const json = JSON.stringify(input);
    detail = json.length > 180 ? json.slice(0, 177) + '…' : json;
  }
  if (detail.length > 300) detail = detail.slice(0, 297) + '…';
  return `${name}: ${detail}`;
}
