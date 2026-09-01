const API_ROOT = "https://api.telegram.org";

/**
 * Telegram отвечает ошибкой, когда правка ничего не меняет. Это не сбой: так
 * бывает, когда двое нажали одну кнопку и второй пересчитал то же состояние.
 */
const NOT_MODIFIED = "message is not modified";

/**
 * Тонкий клиент Bot API. Никогда не бросает: сеть и ошибки Telegram логируются
 * и возвращаются как { ok: false }, чтобы один неудачный вызов не ронял вебхук.
 */
export class Telegram {
  #token;
  #fetch;

  constructor(token, fetchImpl = (...args) => globalThis.fetch(...args)) {
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async call(method, payload) {
    let response;
    try {
      response = await this.#fetch(`${API_ROOT}/bot${this.#token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error(`${method} failed`, error);
      return { ok: false };
    }

    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      console.error(`${method} returned unparsable body`, error);
    }

    if (!body?.ok) {
      const benign = typeof body?.description === "string" && body.description.includes(NOT_MODIFIED);
      const log = benign ? console.log : console.error;
      log(`${method} rejected`, { status: response.status, body, payload });
      return body ?? { ok: false };
    }

    return body;
  }

  sendMessage({ chatId, text, threadId, keyboard }) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...(threadId ? { message_thread_id: threadId } : {}),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /**
   * Rich message (Bot API 10.1): и содержимое, и кнопки задаются разметкой в
   * rich_message.html — отдельный reply_markup такому сообщению не нужен.
   *
   * ephemeral (Bot API 10.2) отправляет сообщение прямо в общий чат, но видит
   * его только один участник. Отвечать эфемерно можно 15 секунд после нажатия
   * кнопки, поэтому обязателен callback_query_id — на нём и держится право.
   */
  sendRichMessage({ chatId, html, threadId, ephemeral }) {
    return this.call("sendRichMessage", {
      chat_id: chatId,
      rich_message: { html },
      ...(threadId ? { message_thread_id: threadId } : {}),
      ...(ephemeral
        ? {
            ephemeral_message_parameters: {
              receiver_user_id: ephemeral.receiverUserId,
              callback_query_id: ephemeral.callbackQueryId,
            },
          }
        : {}),
    });
  }

  /** text и html взаимоисключающи: editMessageText требует ровно одно из них. */
  editMessageText({ chatId, messageId, text, html, keyboard }) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      ...(html ? { rich_message: { html } } : { text }),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /** У эфемерного сообщения message_id всегда 0: адресуется оно иначе. */
  editEphemeralMessageText({ chatId, receiverUserId, ephemeralMessageId, text, html, keyboard }) {
    return this.call("editEphemeralMessageText", {
      chat_id: chatId,
      receiver_user_id: receiverUserId,
      ephemeral_message_id: ephemeralMessageId,
      ...(html ? { rich_message: { html } } : { text }),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  answerCallbackQuery({ id, text }) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text });
  }
}
