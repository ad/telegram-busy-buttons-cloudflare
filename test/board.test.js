import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ICON,
  STYLE,
  SUBSCRIPTION,
  boardText,
  createBoard,
  invalidResourceNames,
  parseBoard,
  renderBoard,
  toggleResource,
  toggleSubscription,
} from "../functions/utils/board.js";
import { CALLBACK_DATA_LIMIT, MAX_RESOURCE_NAME_BYTES, byteLength } from "../functions/utils/codec.js";

const IVAN = { id: 123456789, first_name: "Ivan", last_name: "Petrov" };
const MARY = { id: 987654321, first_name: "Mary" };

const buttons = (board) => renderBoard(board).inline_keyboard.flat();
const named = (board, name) => board.resources.find((r) => r.name === name);

describe("board: создание и рендер", () => {
  it("каждый ресурс в своём ряду, кнопка уведомлений — последняя", () => {
    const { text, inline_keyboard } = renderBoard(createBoard(["prod", "stage"]));

    assert.equal(text, "🟢prod 🟢stage");
    assert.deepEqual(inline_keyboard.map((row) => row.map((b) => b.text)), [["prod"], ["stage"], [ICON.NOTIFY]]);
  });

  it("дубликаты имён схлопываются", () => {
    assert.deepEqual(createBoard(["prod", "prod", "stage"]).resources.map((r) => r.name), ["prod", "stage"]);
  });

  it("свободные кнопки зелёные и без просьбы освободить", () => {
    const [button] = buttons(createBoard(["prod"]));

    assert.equal(button.style, STYLE.FREE);
    assert.equal(buttons(createBoard(["prod"])).filter((b) => b.text === ICON.ASK).length, 0);
  });

  it("у пустой доски есть текст — Telegram не примет пустое сообщение", () => {
    assert.equal(boardText({ resources: [], subscribers: [] }).length > 0, true);
  });
});

describe("board: занять и освободить", () => {
  it("занятый ресурс краснеет, подписывается пользователем и получает 🙇", () => {
    const { board, action } = toggleResource(createBoard(["prod", "stage"]), "prod", IVAN);
    const [main, ask] = renderBoard(board).inline_keyboard[0];

    assert.equal(action, "занимает");
    assert.equal(main.text, "prod Ivan Petrov");
    assert.equal(main.style, STYLE.BUSY);
    assert.equal(ask.text, ICON.ASK);
    assert.equal(boardText(board), "🏗️prod 🟢stage");
  });

  it("освобождение снимает подпись и 🙇", () => {
    const taken = toggleResource(createBoard(["prod"]), "prod", IVAN).board;
    const { board, action } = toggleResource(taken, "prod", MARY);

    assert.equal(action, "освобождает");
    assert.deepEqual(named(board, "prod"), { name: "prod", busy: false, holder: null, holderLabel: "" });
    assert.deepEqual(renderBoard(board).inline_keyboard[0].map((b) => b.text), ["prod"]);
  });

  it("нажатие на один ресурс не трогает остальные", () => {
    const first = toggleResource(createBoard(["prod", "stage"]), "prod", IVAN).board;
    const second = toggleResource(first, "stage", MARY).board;

    assert.deepEqual(named(second, "prod"), { name: "prod", busy: true, holder: IVAN.id, holderLabel: "Ivan Petrov" });
    assert.equal(named(second, "stage").holderLabel, "Mary");
  });

  it("неизвестный ресурс не меняет доску", () => {
    const board = createBoard(["prod"]);
    const result = toggleResource(board, "nope", IVAN);

    assert.equal(result.action, null);
    assert.equal(result.board, board);
  });
});

describe("board: разбор клавиатуры", () => {
  it("клавиатура читается обратно без потерь", () => {
    const before = toggleResource(createBoard(["prod", "stage"]), "prod", IVAN).board;
    const after = parseBoard(renderBoard(before).inline_keyboard);

    assert.deepEqual(after, before);
  });

  it("подписчики переживают перерисовку", () => {
    const withSubscriber = toggleSubscription(createBoard(["prod"]), MARY.id).board;

    assert.deepEqual(parseBoard(renderBoard(withSubscriber).inline_keyboard).subscribers, [MARY.id]);
  });

  it("читается клавиатура, созданная старой версией бота", () => {
    const legacy = [
      [{ text: "prod Ivan Petrov", callback_data: '{"c":"free-prod","u":123456789}' }, { text: "🙇", callback_data: '{"a":"ask","t":123456789,"b":"prod"}' }],
      [{ text: "stage", callback_data: '{"c":"busy-stage"}' }],
      [{ text: "⚡ 1", callback_data: '{"c":"⚡","n":[987654321]}' }],
    ];

    assert.deepEqual(parseBoard(legacy), {
      resources: [
        { name: "prod", busy: true, holder: 123456789, holderLabel: "Ivan Petrov" },
        { name: "stage", busy: false, holder: null, holderLabel: "" },
      ],
      subscribers: [987654321],
    });
  });

  it("читается ещё более старая клавиатура с иконками в тексте кнопки", () => {
    const legacy = [[{ text: "🏗️prod Ivan Petrov", callback_data: '{"c":"free-prod","u":123456789}' }]];

    assert.equal(parseBoard(legacy).resources[0].holderLabel, "Ivan Petrov");
  });

  it("нечитаемые кнопки игнорируются, а не роняют разбор", () => {
    const broken = [[{ text: "?", callback_data: "не json" }, { text: "prod", callback_data: "f|prod" }], [{}]];

    assert.deepEqual(parseBoard(broken).resources.map((r) => r.name), ["prod"]);
  });
});

describe("board: подписка на уведомления", () => {
  it("первое нажатие подписывает, второе отписывает", () => {
    const enabled = toggleSubscription(createBoard(["prod"]), IVAN.id);
    assert.equal(enabled.result, SUBSCRIPTION.ENABLED);
    assert.deepEqual(enabled.board.subscribers, [IVAN.id]);

    const disabled = toggleSubscription(enabled.board, IVAN.id);
    assert.equal(disabled.result, SUBSCRIPTION.DISABLED);
    assert.deepEqual(disabled.board.subscribers, []);
  });

  it("количество подписчиков видно на кнопке", () => {
    const board = toggleSubscription(toggleSubscription(createBoard(["prod"]), IVAN.id).board, MARY.id).board;
    const notify = buttons(board).at(-1);

    assert.equal(notify.text, `${ICON.NOTIFY} 2`);
  });

  // Регрессия: раньше подписчики хранились как JSON-массив десятичных id и
  // на пятом подписчике callback_data переваливала за 64 байта — Telegram
  // отклонял editMessageText, и кнопки переставали работать совсем.
  it("callback_data остаётся в пределах лимита на любом числе подписчиков", () => {
    let board = createBoard(["prod"]);
    let added = 0;

    for (let i = 0; i < 50; i++) {
      const { board: next, result } = toggleSubscription(board, 1000000000 + i);
      if (result === SUBSCRIPTION.FULL) {
        break;
      }
      board = next;
      added++;

      for (const button of buttons(board)) {
        assert.ok(
          byteLength(button.callback_data) <= CALLBACK_DATA_LIMIT,
          `callback_data ${button.callback_data} длиннее ${CALLBACK_DATA_LIMIT} байт`
        );
      }
    }

    assert.ok(added >= 6, `ожидалось хотя бы 6 подписчиков, поместилось ${added}`);
  });

  it("переполнение не выбрасывает подписчика молча", () => {
    let board = createBoard(["prod"]);
    let result;

    for (let i = 0; i < 50 && result !== SUBSCRIPTION.FULL; i++) {
      ({ board, result } = toggleSubscription(board, 1000000000 + i));
    }

    assert.equal(result, SUBSCRIPTION.FULL);
    const last = toggleSubscription(board, 9999999999);
    assert.equal(last.result, SUBSCRIPTION.FULL);
    assert.equal(last.board, board);
  });
});

describe("board: проверка имён", () => {
  it("слишком длинные имена отбраковываются до создания доски", () => {
    const ok = "x".repeat(MAX_RESOURCE_NAME_BYTES);
    const tooLong = "x".repeat(MAX_RESOURCE_NAME_BYTES + 1);

    assert.deepEqual(invalidResourceNames([ok, tooLong]), [tooLong]);
  });

  it("кириллица считается по байтам", () => {
    const name = "п".repeat(MAX_RESOURCE_NAME_BYTES);

    assert.deepEqual(invalidResourceNames([name]), [name]);
  });
});
