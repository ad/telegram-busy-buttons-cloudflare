import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { ICON } from "../functions/utils/board.js";
import { MESSAGES } from "../functions/utils/messages.js";
import { onRequest } from "../functions/webhook/[path].js";
import { richBlocks } from "./support.js";

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

/** Нажатие кнопки внутри rich-сообщения: кнопок в reply_markup у него нет. */
const richCallback = ({ from = IVAN, data, blocks, chatId = IVAN.id, messageId = 77 }) => ({
  callback_query: {
    id: "cb1",
    from,
    data,
    message: { message_id: messageId, chat: { id: chatId }, rich_message: { blocks } },
  },
});

/** Только ряды кнопок: в блоках приезжают и заголовки текста сообщения. */
const rows = (html) => richBlocks(html).filter((block) => block.type === "buttons");

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

describe("webhook: /board", () => {
  const COMMAND = [
    "/board",
    "group/subgroup: 1 2 3 4",
    "one more-group: 1 2",
    "another: testing",
    "leaders: backend settings",
  ].join("\n");

  /** Создаёт сгруппированную доску и возвращает разметку отправленного сообщения. */
  async function board(text = COMMAND) {
    await handle(message(text));
    return lastCall("sendRichMessage").payload.rich_message.html;
  }

  const press = (html, data, from = IVAN) =>
    handle(richCallback({ from, data, blocks: richBlocks(html), chatId: 10, messageId: 5 }));

  it("уходит одним rich-сообщением без reply_markup", async () => {
    await board();
    const payload = lastCall("sendRichMessage").payload;

    assert.equal(callsTo("sendMessage").length, 0);
    assert.equal(payload.reply_markup, undefined);
    assert.equal(payload.chat_id, 10);
  });

  it("группы идут заголовками, ресурсы — кнопками под ними", async () => {
    const blocks = richBlocks(await board());

    assert.deepEqual(
      blocks.map((b) => (b.type === "heading" ? b.text : b.buttons.map((x) => x.text).join(","))),
      [
        "group/subgroup", "1", "2", "3", "4",
        "one more-group", "1", "2",
        "another", "testing",
        "leaders", "backend", "settings",
        ICON.NOTIFY,
      ]
    );
  });

  it("работает в темах форума", async () => {
    await handle(message(COMMAND, { message_thread_id: 77 }));

    assert.equal(lastCall("sendRichMessage").payload.message_thread_id, 77);
  });

  it("без групп показывает формат", async () => {
    await handle(message("/board"));

    assert.equal(lastCall("sendMessage").payload.text, MESSAGES.boardUsage);
    assert.equal(callsTo("sendRichMessage").length, 0);
  });

  it("непонятые строки называются поимённо, доска не создаётся", async () => {
    await handle(message("/board\nleads: backend\nчто-то не то"));

    assert.match(lastCall("sendMessage").payload.text, /Не понял строки: что-то не то/);
    assert.equal(callsTo("sendRichMessage").length, 0);
  });

  it("слишком длинные имена отклоняются", async () => {
    await handle(message(`/board\nleads: ${"x".repeat(80)}`));

    assert.match(lastCall("sendMessage").payload.text, /Слишком длинные имена/);
    assert.equal(callsTo("sendRichMessage").length, 0);
  });

  it("нажатие занимает ресурс и перерисовывает доску целиком", async () => {
    const html = await board();
    const target = rows(html)[1].buttons[0];

    calls = [];
    await press(html, target.callback_data);

    const edit = lastCall("editMessageText").payload;
    assert.equal(edit.text, undefined);
    assert.equal(edit.reply_markup, undefined);
    assert.equal(rows(edit.rich_message.html)[1].buttons[0].text, "2 Ivan");
    assert.equal(rows(edit.rich_message.html)[1].buttons[1].text, ICON.ASK);
    assert.equal(lastCall("answerCallbackQuery").payload.text, "2 Ivan updated");
  });

  it("одноимённые ресурсы из разных групп не путаются", async () => {
    const html = await board();
    // "1" есть и в group/subgroup, и в one more-group — жмём вторую.
    await press(html, "gf|1|1");

    const redrawn = rows(lastCall("editMessageText").payload.rich_message.html);
    assert.equal(redrawn[0].buttons[0].text, "1");
    assert.equal(redrawn[4].buttons[0].text, "1 Ivan");
  });

  it("в уведомлении ресурс назван вместе с группой", async () => {
    let html = await board();
    await press(html, rows(html).at(-1).buttons[0].callback_data, MARY);
    html = lastCall("editMessageText").payload.rich_message.html;

    calls = [];
    await press(html, rows(html)[1].buttons[0].callback_data);

    assert.deepEqual(callsTo("sendMessage").map((c) => c.payload), [
      { chat_id: MARY.id, text: "Ivan занимает group/subgroup/2" },
    ]);
  });

  it("⚡ работает и не превращает доску в обычное сообщение", async () => {
    const html = await board();

    calls = [];
    await press(html, rows(html).at(-1).buttons[0].callback_data);

    const edit = lastCall("editMessageText").payload;
    assert.equal(edit.text, undefined);
    assert.equal(rows(edit.rich_message.html).at(-1).buttons[0].text, `${ICON.NOTIFY} 1`);
    assert.equal(lastCall("answerCallbackQuery").payload.text, MESSAGES.notificationsEnabled);
  });

  it("просьба освободить приходит держателю с именем группы", async () => {
    let html = await board();
    await press(html, rows(html)[1].buttons[0].callback_data);
    html = lastCall("editMessageText").payload.rich_message.html;

    calls = [];
    await press(html, rows(html)[1].buttons[1].callback_data, MARY);

    assert.deepEqual(lastCall("sendMessage").payload, {
      chat_id: IVAN.id,
      text: 'Пользователь Mary просит освободить "group/subgroup/2" если уже не нужно.',
    });
  });

  it("копия в личку повторяет группы и обновляет исходную доску", async () => {
    let html = await board();
    await press(html, rows(html)[1].buttons[0].callback_data);
    html = lastCall("editMessageText").payload.rich_message.html;

    calls = [];
    await press(html, rows(html)[1].buttons[1].callback_data);

    const mirror = lastCall("sendRichMessage").payload.rich_message.html;
    assert.match(mirror, /<h3>group\/subgroup<\/h3>/);
    assert.equal(rows(mirror).at(-1).buttons[0].text, MESSAGES.closeMirror);

    calls = [];
    await handle(
      richCallback({ data: rows(mirror)[1].buttons[0].callback_data, blocks: richBlocks(mirror) })
    );

    const [origin, copy] = callsTo("editMessageText").map((c) => c.payload);
    assert.equal(origin.chat_id, 10);
    assert.equal(origin.message_id, 5);
    assert.equal(rows(origin.rich_message.html)[1].buttons[0].text, "2");
    assert.equal(origin.rich_message.html.includes(MESSAGES.closeMirror), false);

    assert.equal(copy.chat_id, IVAN.id);
    assert.match(copy.rich_message.html, /<h3>group\/subgroup\/2 — освобождён<\/h3>/);
    // Копия гаснет и здесь: состояние доски остаётся текстом, кнопок нет.
    assert.match(copy.rich_message.html, /<blockquote>group\/subgroup: 🟢1 🟢2 🟢3 🟢4<br>/);
    assert.equal(copy.rich_message.html.includes("<tg-button"), false);
  });

  it("старая плоская доска продолжает работать рядом", async () => {
    const keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ data: keyboard[0][0].callback_data, keyboard }));

    const edit = lastCall("editMessageText").payload;
    assert.equal(edit.text, "🏗️prod");
    assert.equal(edit.rich_message, undefined);
    assert.deepEqual(edit.reply_markup.inline_keyboard[0].map((b) => b.text), ["prod Ivan", ICON.ASK]);
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

describe("webhook: порядок вызовов", () => {
  // Callback query протухает за считаные секунды: если сперва править сообщение
  // и рассылать уведомления, всплывашка успевает не дойти.
  it("всплывашка отвечается раньше правки сообщения", async () => {
    const keyboard = await createBoardKeyboard("/create prod");

    calls = [];
    await handle(callback({ data: keyboard[0][0].callback_data, keyboard }));

    assert.deepEqual(calls.map((c) => c.method), ["answerCallbackQuery", "editMessageText"]);
  });

  it("то же для ⚡ и для сгруппированной доски", async () => {
    const keyboard = await createBoardKeyboard("/create prod");

    calls = [];
    await handle(callback({ data: keyboard.at(-1)[0].callback_data, keyboard }));
    assert.equal(calls[0].method, "answerCallbackQuery");

    await handle(message("/board\nleaders: backend"));
    const html = lastCall("sendRichMessage").payload.rich_message.html;

    calls = [];
    await handle(richCallback({ data: rows(html)[0].buttons[0].callback_data, blocks: richBlocks(html), chatId: 10, messageId: 5 }));
    assert.equal(calls[0].method, "answerCallbackQuery");
  });

  it("уведомления подписчикам уходят после ответа нажавшему", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ from: MARY, data: keyboard.at(-1)[0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;

    calls = [];
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));

    assert.deepEqual(calls.map((c) => c.method), ["answerCallbackQuery", "editMessageText", "sendMessage"]);
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

  const buttonsOf = (html) => rows(html).flatMap((block) => block.buttons);
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
      rows(dm.rich_message.html).map((block) => block.buttons.map((b) => b.text)),
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
    const [buttons] = rows(dm.rich_message.html);

    calls = [];
    await handle(richCallback({ data: buttons.buttons[0].callback_data, blocks }));

    const origin = callsTo("editMessageText")[0].payload;
    assert.equal(origin.chat_id, 10);
    assert.equal(origin.message_id, 5);
    assert.equal(origin.text, "🟢prod");
    assert.deepEqual(origin.reply_markup.inline_keyboard[0].map((b) => b.text), ["prod"]);
  });

  it("в исходное сообщение не утекает кнопка закрытия копии", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);
    const [buttons] = rows(dm.rich_message.html);

    await handle(richCallback({ data: buttons.buttons[0].callback_data, blocks }));

    const origin = callsTo("editMessageText")[0].payload;
    const labels = origin.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.equal(labels.includes(MESSAGES.closeMirror), false);
  });

  it("копия перерисовывается: видно результат и новое состояние доски", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);
    const [buttons] = rows(dm.rich_message.html);

    calls = [];
    await handle(richCallback({ data: buttons.buttons[0].callback_data, blocks }));

    const mirror = callsTo("editMessageText")[1].payload;
    assert.equal(mirror.chat_id, IVAN.id);
    assert.equal(mirror.message_id, 77);
    assert.equal(mirror.text, undefined);
    assert.match(mirror.rich_message.html, /<h3>prod — освобождён<\/h3>/);
    assert.match(mirror.rich_message.html, /<blockquote>🟢prod<\/blockquote>/);
  });

  it("после действия копия гаснет: результат виден, а нажать больше нечего", async () => {
    const dm = await selfAsk();

    calls = [];
    await handle(
      richCallback({
        data: rows(dm.rich_message.html)[0].buttons[0].callback_data,
        blocks: richBlocks(dm.rich_message.html),
      })
    );

    const copy = callsTo("editMessageText").at(-1).payload.rich_message.html;
    assert.match(copy, /<h3>prod — освобождён<\/h3>/);
    assert.match(copy, /<blockquote>🟢prod<\/blockquote>/);
    assert.equal(copy.includes("<tg-button"), false);
  });

  it("погасшая копия не может второй раз тронуть исходную доску", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);

    await handle(richCallback({ data: rows(dm.rich_message.html)[0].buttons[0].callback_data, blocks }));

    // Кнопок в копии не осталось — повторное действие невозможно.
    const copy = callsTo("editMessageText").at(-1).payload.rich_message.html;
    assert.deepEqual(rows(copy), []);
  });

  it("⚡ в копии тоже гасит её, а не превращает в обычное сообщение", async () => {
    const dm = await selfAsk();

    calls = [];
    await handle(
      richCallback({
        data: byLabel(dm.rich_message.html, ICON.NOTIFY).callback_data,
        blocks: richBlocks(dm.rich_message.html),
      })
    );

    const [origin, copy] = callsTo("editMessageText").map((c) => c.payload);
    assert.equal(origin.reply_markup.inline_keyboard.at(-1)[0].text, `${ICON.NOTIFY} 1`);

    assert.equal(copy.text, undefined);
    assert.match(copy.rich_message.html, /<h3>Notifications enabled<\/h3>/);
    assert.equal(copy.rich_message.html.includes("<tg-button"), false);
  });

  it("подписчики узнают об освобождении из копии", async () => {
    let keyboard = await createBoardKeyboard("/create prod");
    await handle(callback({ from: MARY, data: keyboard.at(-1)[0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard[0][0].callback_data, keyboard }));
    keyboard = lastCall("editMessageText").payload.reply_markup.inline_keyboard;
    await handle(callback({ from: IVAN, data: keyboard[0][1].callback_data, keyboard }));

    const html = lastCall("sendRichMessage").payload.rich_message.html;
    const blocks = richBlocks(html);
    calls = [];
    await handle(richCallback({ data: rows(html)[0].buttons[0].callback_data, blocks }));

    assert.deepEqual(callsTo("sendMessage").map((c) => c.payload), [
      { chat_id: MARY.id, text: "Ivan освобождает prod" },
    ]);
  });

  it("кнопка закрытия гасит копию, не трогая исходную доску", async () => {
    const dm = await selfAsk();
    const blocks = richBlocks(dm.rich_message.html);
    const [buttons] = rows(dm.rich_message.html);

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
