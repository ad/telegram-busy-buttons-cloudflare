/**
 * Живая проверка rich messages против настоящего Bot API.
 *
 * Отвечает на три вопроса, которые нельзя закрыть модульными тестами:
 *   1. принимает ли Telegram нашу разметку;
 *   2. возвращается ли доска в rich_message.blocks отправленного сообщения;
 *   3. приезжают ли блоки обратно в callback_query, когда жмут кнопку.
 *
 *   BOT_TOKEN=... CHAT_ID=... node scripts/live-check.mjs
 *
 * Токен читается из переменной окружения или из файла .dev-token и нигде не печатается.
 * CHAT_ID можно не задавать — скрипт возьмёт чат из последнего апдейта.
 */

import { readFile } from "node:fs/promises";

import { createGroupedBoard, parseGroupedBoard, parseGroupsCommand, renderGroupedBoard } from "../functions/utils/groups.js";

const COMMAND = [
  "/board",
  "group/subgroup: 1 2 3 4",
  "one more-group: 1 2",
  "another: testing",
  "leaders: backend settings",
].join("\n");

const token = process.env.BOT_TOKEN || (await readFile(new URL("../.dev-token", import.meta.url), "utf8").catch(() => "")).trim();
if (!token) {
  console.error("Нет токена: задай BOT_TOKEN или положи его в .dev-token");
  process.exit(1);
}

async function call(method, payload) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    return await response.json();
  } catch (error) {
    // Сообщения сетевых ошибок содержат URL, а URL содержит токен.
    console.error(`  ✖ ${method}: сетевая ошибка (${error.cause?.code ?? error.name})`);
    process.exit(1);
  }
}

const ok = (label) => console.log(`  ✔ ${label}`);
const fail = (label, detail) => {
  console.log(`  ✖ ${label}`);
  if (detail !== undefined) console.log("    " + JSON.stringify(detail));
};

const board = createGroupedBoard(parseGroupsCommand(COMMAND).groups);
const expected = JSON.stringify(board);

/** Сверяет доску, восстановленную из блоков, с исходной. */
function checkBlocks(label, blocks) {
  if (!Array.isArray(blocks)) {
    return fail(`${label}: блоков нет`, blocks);
  }
  const kinds = [...new Set(blocks.map((b) => b.type))].join(", ");
  console.log(`    блоки: ${blocks.length} шт. (${kinds})`);

  const parsed = parseGroupedBoard(blocks);
  if (JSON.stringify(parsed) === expected) {
    ok(`${label}: доска восстановлена без потерь`);
  } else {
    fail(`${label}: доска восстановилась иначе`, parsed);
  }
}

console.log("1. getMe");
const me = await call("getMe");
me.ok ? ok(`бот @${me.result.username}`) : fail("getMe", me);
if (!me.ok) process.exit(1);

console.log("\n2. deleteWebhook (иначе getUpdates не отдаёт апдейты)");
const dropped = await call("deleteWebhook");
dropped.ok ? ok("вебхук снят") : fail("deleteWebhook", dropped);

let offset = 0;
let chatId = process.env.CHAT_ID;

if (!chatId) {
  console.log("\n   CHAT_ID не задан — напиши боту любое сообщение, жду до 3 минут");
  const waitUntil = Date.now() + 180000;

  while (!chatId && Date.now() < waitUntil) {
    const updates = await call("getUpdates", { offset, timeout: 20 });
    for (const update of updates.result ?? []) {
      offset = update.update_id + 1;
      chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? chatId;
    }
  }

  if (!chatId) {
    console.error("   Не дождался сообщения.");
    process.exit(1);
  }
  console.log(`   чат: ${chatId}`);
}

console.log("\n3. sendRichMessage со сгруппированной доской");
const sent = await call("sendRichMessage", { chat_id: chatId, rich_message: { html: renderGroupedBoard(board) } });
if (!sent.ok) {
  fail("Telegram отклонил разметку", sent);
  process.exit(1);
}
ok("сообщение отправлено");
checkBlocks("в ответе sendRichMessage", sent.result?.rich_message?.blocks);
if (sent.result?.reply_markup) fail("неожиданно: в сообщении есть reply_markup", sent.result.reply_markup);
else ok("reply_markup отсутствует, как и задумано");

console.log("\n4. editMessageText с rich_message");
const edited = await call("editMessageText", {
  chat_id: chatId,
  message_id: sent.result.message_id,
  rich_message: { html: "<h3>Проверка редактирования</h3>" + renderGroupedBoard(board) },
});
edited.ok ? ok("rich-сообщение редактируется") : fail("editMessageText", edited);

console.log("\n5. Нажми любую кнопку в этом сообщении — жду callback_query (90 секунд)");
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const updates = await call("getUpdates", { offset, timeout: 10 });
  for (const update of updates.result ?? []) {
    offset = update.update_id + 1;
    const query = update.callback_query;
    if (!query) continue;

    ok(`нажата кнопка, callback_data = ${JSON.stringify(query.data)}`);
    if (query.message?.reply_markup) fail("в callback пришёл reply_markup", query.message.reply_markup);
    checkBlocks("в callback_query.message", query.message?.rich_message?.blocks);
    process.exit(0);
  }
}
console.log("  … не дождался нажатия");
