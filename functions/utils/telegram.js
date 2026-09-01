const API_ROOT = "https://api.telegram.org";

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
      console.error(`${method} rejected`, { status: response.status, body, payload });
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

  editMessageText({ chatId, messageId, text, keyboard }) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  answerCallbackQuery({ id, text }) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text });
  }
}
