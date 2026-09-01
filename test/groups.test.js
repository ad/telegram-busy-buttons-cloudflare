import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ICON, STYLE } from "../functions/utils/board.js";
import { MAX_GROUPED_NAME_BYTES } from "../functions/utils/codec.js";
import {
  createGroupedBoard,
  invalidGroupedNames,
  isGroupedMessage,
  parseGroupedBoard,
  parseGroupsCommand,
  renderGroupedBoard,
  toggleGroupedResource,
} from "../functions/utils/groups.js";
import { richBlocks } from "./support.js";

const IVAN = { id: 111111111, first_name: "Ivan" };

const COMMAND = [
  "/board",
  "group/subgroup: 1 2 3 4",
  "one more-group: 1 2",
  "another: testing",
  "leaders: backend settings",
].join("\n");

const boardOf = (command = COMMAND) => createGroupedBoard(parseGroupsCommand(command).groups);
const roundTrip = (board) => parseGroupedBoard(richBlocks(renderGroupedBoard(board)));
const buttonBlocks = (board) => richBlocks(renderGroupedBoard(board)).filter((b) => b.type === "buttons");
const labels = (board) => buttonBlocks(board).flatMap((b) => b.buttons.map((x) => x.text));

describe("groups: разбор команды", () => {
  it("строка на группу, ресурсы через пробел", () => {
    assert.deepEqual(parseGroupsCommand(COMMAND).groups, [
      { name: "group/subgroup", items: ["1", "2", "3", "4"] },
      { name: "one more-group", items: ["1", "2"] },
      { name: "another", items: ["testing"] },
      { name: "leaders", items: ["backend", "settings"] },
    ]);
  });

  it("двоеточие внутри имени группы не мешает — режем по первому", () => {
    assert.deepEqual(parseGroupsCommand("/board\nurl: https://example.com").groups, [
      { name: "url", items: ["https://example.com"] },
    ]);
  });

  it("группы можно писать и в одной строке с командой", () => {
    assert.deepEqual(parseGroupsCommand("/board leads: backend").groups, [
      { name: "leads", items: ["backend"] },
    ]);
  });

  it("строки без двоеточия и без ресурсов собираются отдельно", () => {
    const { groups, invalid } = parseGroupsCommand("/board\nпросто строка\nпустая:\nleads: backend");

    assert.deepEqual(groups, [{ name: "leads", items: ["backend"] }]);
    assert.deepEqual(invalid, ["просто строка", "пустая:"]);
  });

  it("лишние пробелы и пустые строки не создают групп", () => {
    assert.deepEqual(parseGroupsCommand("/board\n\n   \n  leads :   backend   settings  ").groups, [
      { name: "leads", items: ["backend", "settings"] },
    ]);
  });

  it("длинные имена отбраковываются по байтам", () => {
    const long = "x".repeat(MAX_GROUPED_NAME_BYTES + 1);

    assert.deepEqual(invalidGroupedNames([{ name: "g", items: ["ok", long] }]), [long]);
    assert.deepEqual(invalidGroupedNames([{ name: "g", items: ["п".repeat(24)] }]), ["п".repeat(24)]);
  });

  it("дубликаты внутри группы схлопываются, между группами — нет", () => {
    const board = boardOf("/board\na: 1 1 2\nb: 1");

    assert.deepEqual(board.groups.map((g) => g.resources.map((r) => r.name)), [["1", "2"], ["1"]]);
  });
});

describe("groups: рендер и разбор", () => {
  it("заголовок группы и по кнопке на ресурс", () => {
    const html = renderGroupedBoard(boardOf());

    assert.match(html, /<h3>group\/subgroup<\/h3><tg-button-row>/);
    assert.equal((html.match(/<h3>/g) || []).length, 4);
    assert.equal((html.match(/<tg-button /g) || []).length, 9 + 1);
  });

  it("индекс группы едет в callback_data, имя группы — нет", () => {
    const html = renderGroupedBoard(boardOf());

    assert.match(html, /data="gf\|0\|1"/);
    assert.match(html, /data="gf\|1\|1"/);
    assert.equal(html.includes("data=\"gf|0|group"), false);
  });

  it("доска восстанавливается из собственного сообщения без потерь", () => {
    const board = toggleGroupedResource(boardOf(), 1, "2", IVAN).board;

    assert.deepEqual(roundTrip(board), board);
  });

  it("одноимённые ресурсы из разных групп не путаются", () => {
    const board = toggleGroupedResource(boardOf(), 1, "1", IVAN).board;
    const parsed = roundTrip(board);

    assert.equal(parsed.groups[0].resources[0].busy, false);
    assert.equal(parsed.groups[1].resources[0].busy, true);
    assert.equal(parsed.groups[1].resources[0].holder, IVAN.id);
  });

  it("посторонний заголовок в тексте не становится группой и не сдвигает индексы", () => {
    const board = toggleGroupedResource(boardOf(), 0, "1", IVAN).board;
    const withProse = "<h3>Зеркало не отвечает</h3><p>текст</p>" + renderGroupedBoard(board);

    assert.deepEqual(parseGroupedBoard(richBlocks(withProse)), board);
  });

  it("занятый ресурс краснеет, подписывается и получает 🙇", () => {
    const board = toggleGroupedResource(boardOf(), 2, "testing", IVAN).board;
    const row = buttonBlocks(board).find((r) => r.buttons[0].text.startsWith("testing"));

    assert.deepEqual(row.buttons.map((b) => b.text), ["testing Ivan", ICON.ASK]);
    assert.equal(row.buttons[0].style, STYLE.BUSY);
    assert.equal(row.buttons[1].callback_data, `ga|2|${IVAN.id.toString(36)}|testing`);
  });

  it("кнопка уведомлений одна на всю доску и стоит последней", () => {
    assert.equal(labels(boardOf()).at(-1), ICON.NOTIFY);
    assert.equal(labels(boardOf()).filter((t) => t.startsWith(ICON.NOTIFY)).length, 1);
  });

  it("имена групп и ресурсов экранируются", () => {
    const html = renderGroupedBoard(boardOf("/board\n<b>&group: <i>item"));

    assert.match(html, /<h3>&lt;b&gt;&amp;group<\/h3>/);
    assert.match(html, />&lt;i&gt;item</);
    assert.equal(parseGroupedBoard(richBlocks(html)).groups[0].resources[0].name, "<i>item");
  });
});

describe("groups: переключение", () => {
  it("занять и освободить меняют только свой ресурс", () => {
    const taken = toggleGroupedResource(boardOf(), 0, "2", IVAN);
    assert.equal(taken.action, "taken");
    assert.equal(taken.group.name, "group/subgroup");

    const freed = toggleGroupedResource(taken.board, 0, "2", IVAN);
    assert.equal(freed.action, "released");
    assert.deepEqual(freed.board.groups[0].resources.map((r) => r.busy), [false, false, false, false]);
  });

  it("несуществующие группа или ресурс не меняют доску", () => {
    const board = boardOf();

    for (const [group, name] of [[99, "1"], [0, "нет"]]) {
      const result = toggleGroupedResource(board, group, name, IVAN);
      assert.equal(result.action, null);
      assert.equal(result.board, board);
    }
  });
});

describe("groups: распознавание доски", () => {
  it("сгруппированная доска отличается от плоской по кнопкам", () => {
    const grouped = { rich_message: { blocks: richBlocks(renderGroupedBoard(boardOf())) } };
    const flat = { reply_markup: { inline_keyboard: [[{ text: "prod", callback_data: "f|prod" }]] } };

    assert.equal(isGroupedMessage(grouped), true);
    assert.equal(isGroupedMessage(flat), false);
    assert.equal(isGroupedMessage({}), false);
  });
});
