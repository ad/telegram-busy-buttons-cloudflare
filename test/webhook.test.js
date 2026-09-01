import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { ICON } from "../functions/utils/board.js";
import { MESSAGES } from "../functions/utils/messages.js";
import { onRequest } from "../functions/webhook/[path].js";

const TOKEN = "123:secret";
const IVAN = { id: 111, first_name: "Ivan" };
const MARY = { id: 222, first_name: "Mary" };

let calls;

/** Подменяет глобальный fetch, чтобы записывать вызовы Bot API вместо походов в сеть. */
function stubTelegram(reply = () => ({ ok: true, result: {} })) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(init.body);
    calls.push({ method, payload });
    return new Response(JSON.stringify(reply(method, payload)), {
      headers: { "Content-Type": "application/json" },
    });
  };
}

const callsTo = (method) => calls.filter((call) => call.method === method);
const lastCall = (method) => callsTo(method).at(-1);

function handle(update, { path = `bot${TOKEN}`, env } = {}) {
  return onRequest({
    params: { path },
    env: { BOT_TOKEN: TOKEN, BOT_ADMIN: "999", ...env },
    request: { json: async () => update },
  });
}

const message = (text, extra = {}) => ({
  message: { message_id: 1, chat: { id: 10 }, from: IVAN, text, ...extra },
});

const callback = ({ from = IVAN, data, keyboard, text = "..." }) => ({
  callback_query: {
    id: "cb1",
    from,
    data,
    message: { message_id: 5, chat: { id: 10 }, text, reply_markup: { inline_keyboard: keyboard } },
  },
});

/** Прогоняет /create и возвращает клавиатуру созданного сообщения. */
async function createBoardKeyboard(text) {
  await handle(message(text));
  return lastCall("sendMessage").payload.reply_markup.inline_keyboard;
}

beforeEach(() => stubTelegram());

describe("webhook: маршрутизация", () => {
  it("чужой путь игнорируется без обращений к Bot API", async () => {
    const response = await handle(message("/create prod"), { path: "botWRONG" });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, []);
  });

  it("сообщение без текста ничего не запускает", async () => {
    await handle({ message: { message_id: 1, chat: { id: 10 }, from: IVAN } });

    assert.deepEqual(calls, []);
  });

  it("обычный текст боту не адресован", async () => {
    await handle(message("просто болтаю"));

    assert.deepEqual(calls, []);
  });

  it("битый JSON в теле запроса не роняет вебхук, а уходит админу", async () => {
    const response = await onRequest({
      params: { path: `bot${TOKEN}` },
      env: { BOT_TOKEN: TOKEN, BOT_ADMIN: "999" },
      request: {
        json: async () => {
          throw new Error("boom");
        },
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(lastCall("sendMessage").payload, { chat_id: "999", text: "boom" });
  });
});

describe("webhook: /create", () => {
  it("создаёт доску с кнопкой на каждый ресурс", async () => {
    await handle(message("/create prod stage"));
    const { payload } = lastCall("sendMessage");

    assert.equal(payload.chat_id, 10);
    assert.equal(payload.text, "🟢prod 🟢stage");
    assert.deepEqual(payload.reply_markup.inline_keyboard.map((row) => row.map((b) => b.text)), [
      ["prod"],
      ["stage"],
      [ICON.NOTIFY],
    ]);
  });

  it("работает в темах форума", async () => {
    await handle(message("/create prod", { message_thread_id: 77 }));

    assert.equal(lastCall("sendMessage").payload.message_thread_id, 77);
  });

  it("без имён показывает подсказку", async () => {
    await handle(message("/create"));

    assert.equal(lastCall("sendMessage").payload.text, MESSAGES.usage);
  });

  it("/start показывает подсказку", async () => {
    await handle(message("/start"));

    assert.equal(lastCall("sendMessage").payload.text, MESSAGES.usage);
  });

  it("слишком длинные имена отклоняются с объяснением, а не молча ломают кнопки", async () => {
    await handle(message(`/create prod ${"x".repeat(80)}`));
    const { payload } = lastCall("sendMessage");

    assert.match(payload.text, /Слишком длинные имена/);
    assert.equal(payload.reply_markup, undefined);
  });
});

describe("webhook: занять и освободить", () => {
  it("нажатие перерисовывает сообщение и подтверждает нажавшему", async () => {
    const keyboard = await createBoardKeyboard("/create prod stage");
    await handle(callback({ data: keyboard[0][0].callback_data, keyboard }));

    const edit = lastCall("editMessageText").payload;
    assert.equal(edit.message_id, 5);
    assert.equal(edit.text, "🏗️prod 🟢stage");
    assert.deepEqual(edit.reply_markup.inline_keyboard[0].map((b) => b.text), ["prod Ivan", ICON.ASK]);

    assert.equal(lastCall("answerCallbackQuery").payload.text, "prod Ivan updated");
  });

  it("повторное нажатие освобождает ресурс", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ data: keyboard[0][0].callback_data, keyboard }));

    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: MARY, data: keyboard[0][0].callback_data, keyboard }));

    const edit = lastCall("editMessageText").payload;
    assert.equal(edit.text, "🟢prod");
    assert.deepEqual(edit.reply_markup.inline_keyboard[0].map((b) => b.text), ["prod"]);
  });

  it("кнопка из старого сообщения продолжает работать", async () => {
    const keyboard = [
      [{ text: "prod", callback_data: '{"c":"busy-prod"}' }],
      [{ text: "⚡", callback_data: '{"c":"⚡","n":[]}' }],
    ];
    await handle(callback({ data: keyboard[0][0].callback_data, keyboard }));

    assert.equal(lastCall("editMessageText").payload.text, "🏗️prod");
  });

  it("устаревшая кнопка сообщает об этом вместо тихого игнорирования", async () => {
    await handle(callback({ data: "мусор", keyboard: [] }));

    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.unknownButton);
    assert.equal(callsTo("editMessageText").length, 0);
  });
});

describe("webhook: уведомления", () => {
  it("подписчики получают уведомление, а сам нажавший — нет", async () => {
    let keyboard = await createBoardKeyboard("/create prod");

    await handle(callback({ from: MARY, data: keyboard.at(-1)[0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard.at(-1)[0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;

    assert.equal(keyboard.at(-1)[0].text, `${ICON.NOTIFY} 2`);

    calls = [];
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));

    assert.deepEqual(callsTo("sendMessage").map((c) => c.payload), [
      { chat_id: MARY.id, text: "Ivan занимает prod" },
    ]);
  });

  it("повторное нажатие ⚡ отписывает", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ data: keyboard.at(-1)[0].callback_data, keyboard }));

    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.notificationsEnabled);

    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ data: keyboard.at(-1)[0].callback_data, keyboard }));

    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.notificationsDisabled);
    assert.equal(lastCall("editMessageText").payload.reply_markup.inline_keyboard.at(-1)[0].text, ICON.NOTIFY);
  });

  it("при переполнении списка бот честно говорит об этом", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    let answer;

    for (let i = 0; i < 20; i++) {
      await handle(callback({ from: { id: 1000000000 + i }, data: keyboard.at(-1)[0].callback_data, keyboard }));
      answer = lastCall("answerCallbackQuery").payload.text;
      if (answer.startsWith("Список подписчиков переполнен")) {
        break;
      }
      keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    }

    assert.match(answer, /^Список подписчиков переполнен/);
  });
});

describe("webhook: просьба освободить", () => {
  it("уходит держателю ресурса", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;

    calls = [];
    await handle(callback({ from: MARY, data: keyboard[0][1].callback_data, keyboard }));

    assert.deepEqual(lastCall("sendMessage").payload, {
      chat_id: IVAN.id,
      text: 'Пользователь Mary просит освободить "prod" если уже не нужно.',
    });
    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askSent);
  });

  it("просьба самому себе превращается в шутку и никого не беспокоит", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;

    calls = [];
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard }));

    assert.deepEqual(callsTo("sendMessage"), []);
    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askYourself);
  });

  it("недоставленная просьба не выдаётся за отправленную", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;

    stubTelegram((method) => (method === "sendMessage" ? { ok: false, description: "bot was blocked" } : { ok: true }));
    await handle(callback({ from: MARY, data: keyboard[0][1].callback_data, keyboard }));

    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askFailed);
  });
});

describe("webhook: отладка", () => {
  it("BOT_DEBUG=false не считается включённой отладкой", async () => {
    await handle(message("/create prod"), { env: { BOT_DEBUG: "false" } });

    assert.equal(callsTo("sendMessage").length, 1);
  });

  it("включённая отладка шлёт админу описание апдейта", async () => {
    await handle(message("/create prod"), { env: { BOT_DEBUG: "true" } });

    assert.equal(callsTo("sendMessage")[0].payload.chat_id, "999");
    assert.match(callsTo("sendMessage")[0].payload.text, /Message from Ivan \(111\)/);
  });
});
