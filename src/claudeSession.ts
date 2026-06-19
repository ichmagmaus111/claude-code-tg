import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SDKResultMessage,
  type PermissionMode,
  type CanUseTool,
  type ModelInfo,
  type SlashCommand,
  type AgentInfo,
  type McpServerStatus,
} from '@anthropic-ai/claude-agent-sdk';
import type { Config } from './config.js';
import { MessageQueue } from './queue.js';
import type { PermissionPrompter } from './permissions.js';

export type UserContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

/** Контент пользовательского сообщения: простой текст или мультимодальные блоки. */
export type UserContent = string | UserContentBlock[];

export interface SessionCallbacks {
  onText(text: string): Promise<void>;
  /** Частичный (накопленный) текст ответа во время генерации — для стриминга черновика. */
  onTextDelta?(accumulated: string): Promise<void> | void;
  onToolUse(name: string, input: Record<string, unknown>): Promise<void>;
  onInit(info: { sessionId: string; model: string; mode: PermissionMode }): Promise<void>;
  onResult(result: SDKResultMessage): Promise<void>;
  onError(message: string): Promise<void>;
}

export interface SessionOptions {
  config: Config;
  prompter: PermissionPrompter;
  callbacks: SessionCallbacks;
  /** UUID сессии для возобновления (/resume). */
  resume?: string;
  /** Рабочая папка сессии. Если не задана — берётся из config.workingDir. */
  cwd?: string;
  model?: string;
  mode?: PermissionMode;
}

/**
 * Обёртка над одной сессией Claude Code (`query()` в режиме streaming-input).
 * Держит долгоживущий итератор, прокидывает пользовательские сообщения,
 * рендерит ответы через колбэки и предоставляет управляющие методы
 * (смена режима/модели, прерывание, списки команд/моделей).
 */
export class ClaudeSession {
  private queue = new MessageQueue();
  private q: Query | null = null;
  private loop: Promise<void> | null = null;
  private readonly abort = new AbortController();
  private partialBuf = ''; // накопленный текст текущего ответа (для стриминга)

  sessionId: string | undefined;
  model: string;
  mode: PermissionMode;

  get cwd(): string {
    return this.opts.cwd ?? this.opts.config.workingDir;
  }

  constructor(private readonly opts: SessionOptions) {
    this.sessionId = opts.resume;
    this.model = opts.model ?? opts.config.defaultModel ?? 'default';
    this.mode = opts.mode ?? opts.config.defaultMode;
  }

  /** Запускает query и фоновый цикл чтения сообщений. Идемпотентно. */
  start(): void {
    if (this.q) return;

    const canUseTool: CanUseTool = async (toolName, input, options) =>
      this.opts.prompter({
        toolName,
        input,
        title: options.title,
        description: options.description,
        suggestions: options.suggestions,
      });

    this.q = query({
      prompt: this.queue,
      options: {
        cwd: this.opts.cwd ?? this.opts.config.workingDir,
        abortController: this.abort,
        canUseTool,
        permissionMode: this.mode,
        // нужно, чтобы режим bypassPermissions можно было включать на лету
        allowDangerouslySkipPermissions: true,
        // подгружаем настройки, команды, скиллы, плагины и CLAUDE.md из проекта/юзера
        settingSources: ['user', 'project', 'local'],
        model: this.opts.config.defaultModel,
        resume: this.opts.resume,
        // частичные сообщения нужны для стриминга ответа в черновик Telegram
        includePartialMessages: true,
      },
    });

    this.loop = this.consume().catch(async (err) => {
      await this.opts.callbacks.onError(formatError(err));
    });
  }

  private async consume(): Promise<void> {
    if (!this.q) return;
    try {
      for await (const msg of this.q as AsyncIterable<SDKMessage>) {
        await this.handle(msg);
      }
    } catch (err) {
      if (!this.abort.signal.aborted) {
        await this.opts.callbacks.onError(formatError(err));
      }
    }
  }

  private async handle(msg: SDKMessage): Promise<void> {
    // session_id присутствует почти на всех сообщениях — фиксируем для /resume
    const sid = (msg as { session_id?: string }).session_id;
    if (sid) this.sessionId = sid;

    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          this.model = msg.model;
          this.mode = msg.permissionMode;
          this.sessionId = msg.session_id;
          await this.opts.callbacks.onInit({
            sessionId: msg.session_id,
            model: msg.model,
            mode: msg.permissionMode,
          });
        }
        return;
      }
      case 'assistant': {
        const content = msg.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content as unknown as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string') {
            await this.opts.callbacks.onText(block.text);
          } else if (block.type === 'tool_use') {
            await this.opts.callbacks.onToolUse(
              String(block.name ?? 'tool'),
              (block.input as Record<string, unknown>) ?? {},
            );
          }
          // thinking / redacted_thinking блоки намеренно не показываем
        }
        return;
      }
      case 'result': {
        await this.opts.callbacks.onResult(msg);
        return;
      }
      case 'stream_event': {
        // частичные дельты ответа → накапливаем текст и отдаём для стриминга
        const ev = msg.event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (ev?.type === 'message_start') {
          this.partialBuf = '';
        } else if (
          ev?.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta' &&
          typeof ev.delta.text === 'string'
        ) {
          this.partialBuf += ev.delta.text;
          await this.opts.callbacks.onTextDelta?.(this.partialBuf);
        }
        return;
      }
      default:
        return; // прочие системные/служебные сообщения игнорируем
    }
  }

  /** Отправляет текст (или нативную слэш-команду) в Claude. */
  send(text: string): void {
    this.sendContent(text);
  }

  /** Отправляет произвольный контент: текст и/или картинки (мультимодально). */
  sendContent(content: UserContent): void {
    this.start();
    const userMessage: SDKUserMessage = {
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content } as SDKUserMessage['message'],
    };
    this.queue.push(userMessage);
  }

  async setMode(mode: PermissionMode): Promise<void> {
    this.start();
    await this.q!.setPermissionMode(mode);
    this.mode = mode;
  }

  async setModel(model?: string): Promise<void> {
    this.start();
    await this.q!.setModel(model);
    this.model = model ?? 'default';
  }

  async interrupt(): Promise<void> {
    if (this.q) await this.q.interrupt();
  }

  async listCommands(): Promise<SlashCommand[]> {
    this.start();
    return this.q!.supportedCommands();
  }

  async listModels(): Promise<ModelInfo[]> {
    this.start();
    return this.q!.supportedModels();
  }

  async listAgents(): Promise<AgentInfo[]> {
    this.start();
    return this.q!.supportedAgents();
  }

  async mcpStatus(): Promise<McpServerStatus[]> {
    this.start();
    return this.q!.mcpServerStatus();
  }

  /** Завершает сессию и освобождает ресурсы. */
  async close(): Promise<void> {
    this.queue.close();
    this.abort.abort();
    try {
      await this.loop;
    } catch {
      /* игнор */
    }
    this.q = null;
  }
}

function formatError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return `Ошибка Claude: ${text}`;
}
