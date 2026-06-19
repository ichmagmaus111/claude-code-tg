import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Push-ориентированная асинхронная очередь сообщений.
 *
 * `query()` из Agent SDK в режиме streaming-input ожидает `AsyncIterable<SDKUserMessage>`.
 * Этот класс позволяет нам держать один долгоживущий итератор на сессию и
 * докидывать в него пользовательские сообщения по мере их прихода из Telegram.
 */
export class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;
    const resolve = this.waiting.shift();
    if (resolve) {
      resolve({ value: msg, done: false });
    } else {
      this.buffer.push(msg);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let resolve;
    while ((resolve = this.waiting.shift())) {
      resolve({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
        this.waiting.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
