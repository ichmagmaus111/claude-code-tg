import type { Context } from 'grammy';

export interface TelegramTarget {
  chatId: number;
  threadId?: number;
  directMessagesTopicId?: number;
  replyToMessageId?: number;
}

export interface ChatScope extends TelegramTarget {
  key: string;
  rootKey: string;
}

type MaybeThreadedMessage = {
  message_id?: number;
  message_thread_id?: number;
  direct_messages_topic?: { topic_id?: number; id?: number };
};

export function scopeKey(
  chatId: number,
  threadId?: number,
  directMessagesTopicId?: number,
): string {
  if (threadId !== undefined) return `${chatId}:${threadId}`;
  if (directMessagesTopicId !== undefined) return `${chatId}:dm:${directMessagesTopicId}`;
  return String(chatId);
}

export function scopeFromContext(ctx: Context): ChatScope | undefined {
  const callbackMessage = ctx.callbackQuery?.message;
  const callbackChatId =
    callbackMessage && 'chat' in callbackMessage ? callbackMessage.chat.id : undefined;
  const chatId = ctx.chat?.id ?? callbackChatId ?? ctx.from?.id;
  if (chatId === undefined) return undefined;

  const message = (ctx.message ?? callbackMessage) as MaybeThreadedMessage | undefined;
  const threadId =
    typeof message?.message_thread_id === 'number' ? message.message_thread_id : undefined;
  const directMessagesTopicId =
    typeof message?.direct_messages_topic?.topic_id === 'number'
      ? message.direct_messages_topic.topic_id
      : typeof message?.direct_messages_topic?.id === 'number'
        ? message.direct_messages_topic.id
        : undefined;

  return {
    chatId,
    directMessagesTopicId,
    threadId,
    replyToMessageId: message?.message_id,
    key: scopeKey(chatId, threadId, directMessagesTopicId),
    rootKey: String(chatId),
  };
}

export function targetFromScope(scope: TelegramTarget): TelegramTarget {
  return {
    chatId: scope.chatId,
    threadId: scope.threadId,
    directMessagesTopicId: scope.directMessagesTopicId,
    replyToMessageId: scope.replyToMessageId,
  };
}

export function withThread<T extends Record<string, unknown>>(
  target: TelegramTarget,
  options: T,
): T & {
  message_thread_id?: number;
  direct_messages_topic_id?: number;
} {
  const threaded = { ...options } as T & {
    message_thread_id?: number;
    direct_messages_topic_id?: number;
  };
  if (target.threadId !== undefined) threaded.message_thread_id = target.threadId;
  if (target.directMessagesTopicId !== undefined) {
    threaded.direct_messages_topic_id = target.directMessagesTopicId;
  }
  return threaded;
}

export function withReplyTarget<T extends Record<string, unknown>>(
  target: TelegramTarget,
  options: T,
): T & {
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
} {
  const threaded = withThread(target, options) as T & {
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
  };
  if (target.replyToMessageId !== undefined && threaded.reply_parameters === undefined) {
    threaded.reply_parameters = {
      message_id: target.replyToMessageId,
      allow_sending_without_reply: true,
    };
  }
  return threaded;
}

export function richPayload(target: TelegramTarget): {
  chat_id: number;
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
} {
  const payload: {
    chat_id: number;
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
  } = { chat_id: target.chatId };
  if (target.threadId !== undefined) payload.message_thread_id = target.threadId;
  if (target.directMessagesTopicId !== undefined) {
    payload.direct_messages_topic_id = target.directMessagesTopicId;
  }
  if (target.replyToMessageId !== undefined) {
    payload.reply_parameters = {
      message_id: target.replyToMessageId,
      allow_sending_without_reply: true,
    };
  }
  return payload;
}

export function richDraftPayload(target: TelegramTarget): {
  chat_id: number;
  message_thread_id?: number;
  direct_messages_topic_id?: number;
} {
  const payload: {
    chat_id: number;
    message_thread_id?: number;
    direct_messages_topic_id?: number;
  } = { chat_id: target.chatId };
  if (target.threadId !== undefined) payload.message_thread_id = target.threadId;
  if (target.directMessagesTopicId !== undefined) {
    payload.direct_messages_topic_id = target.directMessagesTopicId;
  }
  return payload;
}
