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

const callback = ({ from = IVAN, data, keyboard, text = "...", chat = { id: 10 }, messageId = 5 }) => ({
  callback_query: {
    id: "cb1",
    from,
    data,
    message: { message_id: messageId, chat, text, reply_markup: { inline_keyboard: keyboard } },
  },
});

/** Прогоняет /create и возвращает клавиатуру созданного сообщения. */
async function createBoardKeyboard(text) {
  await handle(message(text));
  return lastCall("sendMessage").payload.reply_markup.inline_keyboard;
}

const UNESCAPE = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unescapeHtml = (value) => value.replace(/&(amp|lt|gt|quot|apos);/g, (m) => UNESCAPE[m]);

/**
 * Разбирает разметку, которую бот реально отправил, обратно в блоки rich-сообщения —
 * ровно в том виде, в каком Telegram вернёт их в callback_query.message.
 */
function richBlocks(html) {
  return [...html.matchAll(/<tg-button-row>(.*?)<\/tg-button-row>/g)].map((row) => ({
    type: "buttons",
    buttons: [
      ...row[1].matchAll(/<tg-button type="callback_data"(?: style="([^"]*)")? data="([^"]*)">(.*?)<\/tg-button>/g),
    ].map((match) => ({ style: match[1], callback_data: unescapeHtml(match[2]), text: unescapeHtml(match[3]) })),
  }));
}

/** Нажатие кнопки внутри rich-сообщения: кнопок в reply_markup у него нет. */
const richCallback = ({ from = IVAN, data, blocks, chatId = IVAN.id, messageId = 77 }) => ({
  callback_query: {
    id: "cb1",
    from,
    data,
    message: { message_id: messageId, chat: { id: chatId }, rich_message: { blocks } },
  },
});

/** Доска из одного ресурса, занятого IVAN; возвращает её актуальную клавиатуру. */
async function takenBoard() {
  const initial = await createBoardKeyboard("/create prod");
  await handle(callback({ from: IVAN, data: initial[0][0].callback_data, keyboard: initial }));
  return { keyboard: lastCall("editMessageText").payload.reply_markup.inline_keyboard };
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
    const { keyboard } = await takenBoard();

    calls = [];
    await handle(callback({ from: MARY, data: keyboard[0][1].callback_data, keyboard }));

    assert.deepEqual(lastCall("sendMessage").payload, {
      chat_id: IVAN.id,
      text: 'Пользователь Mary просит освободить "prod" если уже не нужно.',
    });
    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askSent);
  });

  it("просьба самому себе превращается в шутку и никого больше не беспокоит", async () => {
    const { keyboard } = await takenBoard();

    calls = [];
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard }));

    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askYourself);
    // Единственное сообщение уходит самому нажавшему, а не держателю или в чат.
    assert.deepEqual(callsTo("sendMessage"), []);
    assert.deepEqual(callsTo("sendRichMessage").map((c) => c.payload.chat_id), [IVAN.id]);
  });

  it("недоставленная просьба не выдаётся за отправленную", async () => {
    const { keyboard } = await takenBoard();

    stubTelegram((method) => (method === "sendMessage" ? { ok: false, description: "bot was blocked" } : { ok: true }));
    await handle(callback({ from: MARY, data: keyboard[0][1].callback_data, keyboard }));

    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askFailed);
  });
});

describe("webhook: копия доски в личке", () => {
  /** Нажимает 🙇 на собственном ресурсе и возвращает отправленную в личку копию. */
  async function selfAsk() {
    const { keyboard } = await takenBoard();
    calls = [];
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard }));
    return lastCall("sendRichMessage").payload;
  }

  const buttonsOf = (html) => richBlocks(html).flatMap((block) => block.buttons);
  const find = (html, test) => buttonsOf(html).find(test);
  const byLabel = (html, label) => find(html, (b) => b.text === label);

  it("уходит методом sendRichMessage, а не sendMessage", async () => {
    await selfAsk();

    assert.equal(callsTo("sendMessage").length, 0);
    assert.equal(callsTo("sendRichMessage").length, 1);
  });

  it("содержимое передаётся в rich_message.html", async () => {
    const dm = await selfAsk();

    assert.equal(dm.chat_id, IVAN.id);
    assert.deepEqual(Object.keys(dm.rich_message), ["html"]);
    assert.equal(dm.text, undefined);
    assert.equal(dm.parse_mode, undefined);
    assert.match(dm.rich_message.html, /<h3>/);
    assert.match(dm.rich_message.html, /<blockquote expandable>.+<cite>.+<\/cite><\/blockquote>/);
    assert.match(dm.rich_message.html, /<code>prod<\/code>/);
  });

  it("кнопки лежат в разметке, а не в reply_markup", async () => {
    const dm = await selfAsk();

    assert.equal(dm.reply_markup, undefined);
    assert.deepEqual(
      richBlocks(dm.rich_message.html).map((block) => block.buttons.map((b) => b.text)),
      [["prod Ivan", ICON.ASK], [ICON.NOTIFY], [MESSAGES.closeMirror]]
    );
  });

  it("стиль кнопок переезжает в атрибут style", async () => {
    const dm = await selfAsk();

    assert.equal(byLabel(dm.rich_message.html, "prod Ivan").style, "danger");
    assert.equal(byLabel(dm.rich_message.html, ICON.ASK).style, "primary");
  });

  it("имя ресурса экранируется и в тексте, и в data кнопки", async () => {
    await handle(message('/create "<b>&prod'));
    let keyboard = lastCall("sendMessage").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard }));

    const html = lastCall("sendRichMessage").payload.rich_message.html;
    // В тексте достаточно & < >, в атрибуте дополнительно экранируются кавычки.
    assert.match(html, /<code>"&lt;b&gt;&amp;prod<\/code>/);
    assert.match(html, /data="b\|[0-9a-z]+\|&quot;&lt;b&gt;&amp;prod"/);
    // Разметка остаётся разбираемой: имя доезжает до callback_data без искажений.
    assert.equal(buttonsOf(html)[0].callback_data, `b|${IVAN.id.toString(36)}|"<b>&prod`);
  });

  it("нажатие в копии освобождает ресурс в исходном чате", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);

    calls = [];
    await handle(richCallback({ data: blocks[0].buttons[0].callback_data, blocks }));

    const origin = callsTo("editMessageText")[0].payload;
    assert.equal(origin.chat_id, 10);
    assert.equal(origin.message_id, 5);
    assert.equal(origin.text, "🟢prod");
    assert.deepEqual(origin.reply_markup.inline_keyboard[0].map((b) => b.text), ["prod"]);
  });

  it("в исходное сообщение не утекает кнопка закрытия копии", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);

    await handle(richCallback({ data: blocks[0].buttons[0].callback_data, blocks }));

    const origin = callsTo("editMessageText")[0].payload;
    const labels = origin.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.equal(labels.includes(MESSAGES.closeMirror), false);
  });

  it("копия перерисовывается: видно результат и новое состояние доски", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);

    calls = [];
    await handle(richCallback({ data: blocks[0].buttons[0].callback_data, blocks }));

    const mirror = callsTo("editMessageText")[1].payload;
    assert.equal(mirror.chat_id, IVAN.id);
    assert.equal(mirror.message_id, 77);
    assert.equal(mirror.text, undefined);
    assert.match(mirror.rich_message.html, /<h3>prod — освобождён<\/h3>/);
    assert.match(mirror.rich_message.html, /<blockquote>🟢prod<\/blockquote>/);
  });

  it("перерисованная копия остаётся рабочей и показывает обратное действие", async () => {
    const dm = await selfAsk();
    let blocks = richBlocks(dm.rich_message.html);

    await handle(richCallback({ data: blocks[0].buttons[0].callback_data, blocks }));
    blocks = richBlocks(callsTo("editMessageText").at(-1).payload.rich_message.html);

    // Ресурс снова свободен: кнопка зелёная и без 🙇.
    assert.deepEqual(blocks[0].buttons.map((b) => b.text), ["prod"]);
    assert.equal(blocks[0].buttons[0].style, "success");

    calls = [];
    await handle(richCallback({ data: blocks[0].buttons[0].callback_data, blocks }));

    assert.equal(callsTo("editMessageText")[0].payload.text, "🏗️prod");
    assert.match(callsTo("editMessageText")[1].payload.rich_message.html, /<h3>prod — занят<\/h3>/);
  });

  it("⚡ в копии тоже перерисовывает её, а не превращает в обычное сообщение", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);

    calls = [];
    await handle(richCallback({ data: byLabel(dm.rich_message.html, ICON.NOTIFY).callback_data, blocks }));

    const mirror = callsTo("editMessageText")[1].payload;
    assert.match(mirror.rich_message.html, /<h3>Notifications enabled<\/h3>/);
    assert.equal(byLabel(mirror.rich_message.html, `${ICON.NOTIFY} 1`) !== undefined, true);
  });

  it("подписчики узнают об освобождении из копии", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ from: MARY, data: keyboard.at(-1)[0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard }));

    const blocks = richBlocks(lastCall("sendRichMessage").payload.rich_message.html);
    calls = [];
    await handle(richCallback({ data: blocks[0].buttons[0].callback_data, blocks }));

    assert.deepEqual(callsTo("sendMessage").map((c) => c.payload), [
      { chat_id: MARY.id, text: "Ivan освобождает prod" },
    ]);
  });

  it("кнопка закрытия гасит копию, не трогая исходную доску", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);

    calls = [];
    await handle(richCallback({ data: byLabel(dm.rich_message.html, MESSAGES.closeMirror).callback_data, blocks }));

    assert.equal(callsTo("editMessageText").length, 1);
    const closed = lastCall("editMessageText").payload;
    assert.equal(closed.message_id, 77);
    assert.equal(closed.text, undefined);
    assert.match(closed.rich_message.html, /Копия закрыта/);
    assert.equal(closed.rich_message.html.includes("<tg-button"), false);
  });

  it("в личном чате с ботом копия не нужна — доска уже перед глазами", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    const inPrivate = { chat: { id: IVAN.id }, messageId: 5 };

    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard, ...inPrivate }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;

    calls = [];
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard, ...inPrivate }));

    assert.deepEqual(callsTo("sendRichMessage"), []);
    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.askYourself);
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
