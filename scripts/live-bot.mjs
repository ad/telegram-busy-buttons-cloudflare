/**
 * Запускает бота локально против живого Bot API через long polling и ведёт
 * чек-лист сценариев: жмёшь кнопки в Telegram — скрипт отмечает, что проверено,
 * и громко ругается на любой отказ Telegram.
 *
 *   node scripts/live-bot.mjs
 *
 * Токен берётся из .dev-token или BOT_TOKEN и нигде не печатается.
 */

import { readFile } from "node:fs/promises";

import { ACTION, decodeCallbackData, encodeAsk, encodeResource } from "../functions/utils/codec.js";
import {
  createGroupedBoard,
  isGroupedMessage,
  parseGroupsCommand,
  renderGroupedBoard,
} from "../functions/utils/groups.js";
import { messageButtons } from "../functions/utils/rich.js";
import { onRequest } from "../functions/webhook/[path].js";

const token = process.env.BOT_TOKEN || (await readFile(new URL("../.dev-token", import.meta.url), "utf8").catch(() => "")).trim();
if (!token) {
  console.error("Нет токена: задай BOT_TOKEN или положи его в .dev-token");
  process.exit(1);
}

const CHECKLIST = [
  ["flat:create", "/create — плоская доска"],
  ["flat:take", "плоская: занять ресурс"],
  ["flat:release", "плоская: освободить ресурс"],
  ["flat:notify", "плоская: ⚡ подписка"],
  ["flat:ask-other", "плоская: 🙇 чужому держателю"],
  ["flat:ask-self", "плоская: 🙇 себе → копия в личку"],
  ["grouped:create", "/board — сгруппированная доска"],
  ["grouped:take", "группы: занять ресурс"],
  ["grouped:release", "группы: освободить ресурс"],
  ["grouped:notify", "группы: ⚡ подписка"],
  ["grouped:ask-other", "группы: 🙇 чужому держателю"],
  ["grouped:ask-self", "группы: 🙇 себе → копия в личку"],
  ["mirror:act", "копия: действие → доска обновилась, копия погасла"],
  ["mirror:close", "копия: ❌ Закрыть"],
  ["error:usage", "подсказка при команде без аргументов"],
  ["error:bad", "жалоба на непонятые строки или длинные имена"],
  ["error:stale", "реакция на устаревшую кнопку"],
];

// Свой вывод держим отдельно: обработчик пишет в console.log своё, и это мешает.
const say = console.log;

const done = new Set();
const failures = [];

function mark(key) {
  if (!key || done.has(key)) return;
  done.add(key);
  const [, label] = CHECKLIST.find(([k]) => k === key) ?? [];
  say(`   ✔ ${label ?? key}   (${done.size}/${CHECKLIST.length})`);
}

/**
 * Сценарии, до которых руками не добраться: чужой держатель требует второго
 * аккаунта, а устаревшая кнопка — старого сообщения. Это подпорки прогона,
 * в самом боте таких команд нет.
 */
const NOBODY = 1; // несуществующий пользователь: отправка ему заведомо провалится

const HELPERS = {
  "/stale": (chatId) =>
    call("sendMessage", {
      chat_id: chatId,
      text: "Кнопка с непонятными данными",
      reply_markup: { inline_keyboard: [[{ text: "устаревшая кнопка", callback_data: "мусор" }]] },
    }),

  "/other": async (chatId) => {
    const busy = { name: "prod", busy: true, holder: NOBODY, holderLabel: "Кто-то другой" };

    await call("sendMessage", {
      chat_id: chatId,
      text: "🏗️prod — держит другой",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "prod Кто-то другой", style: "danger", callback_data: encodeResource(busy) },
            { text: "🙇", style: "primary", callback_data: encodeAsk(busy) },
          ],
          [{ text: "⚡", callback_data: "n|" }],
        ],
      },
    });

    const board = createGroupedBoard(parseGroupsCommand("/board\nчужая группа: prod").groups);
    board.groups[0].resources[0] = busy;

    return call("sendRichMessage", { chat_id: chatId, rich_message: { html: renderGroupedBoard(board) } });
  },
};

/** Перехватывает вызовы Bot API, чтобы видеть отказы Telegram. URL не печатаем — в нём токен. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const method = String(url).split("/").pop();
  const response = await realFetch(url, init);
  const body = await response.clone().json().catch(() => null);

  // Правка, которая ничего не меняет, — не сбой: так бывает при двойном нажатии.
  const benign = String(body?.description ?? "").includes("message is not modified");

  if (body && body.ok === false && !benign) {
    const detail = `${method}: ${body.description ?? "отказ"}`;
    failures.push(detail);
    say(`   ✖ ${detail}`);
    if (method !== "answerCallbackQuery") {
      say(`     payload: ${init.body.slice(0, 400)}`);
    }
  } else {
    say(`   · ${method}${benign ? " (без изменений)" : ""}`);
  }

  return response;
};

const call = (method, payload) =>
  realFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  }).then((r) => r.json());

/** По какому сценарию отработал апдейт. */
function classify(update) {
  const text = update.message?.text;
  if (text) {
    const [command, ...args] = text.trim().split(/\s+/);
    if (command.startsWith("/create")) return args.length === 0 ? "error:usage" : "flat:create";
    if (command.startsWith("/board")) {
      const lines = text.replace(/^\/\S*/, "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return "error:usage";
      return lines.every((l) => l.includes(":") && l.split(":")[1].trim()) ? "grouped:create" : "error:bad";
    }
    return null;
  }

  const query = update.callback_query;
  if (!query) return null;

  const payload = decodeCallbackData(query.data);
  if (!payload) return "error:stale";

  if (payload.action === ACTION.ORIGIN) return "mirror:close";

  const buttons = messageButtons(query.message);
  const inMirror = buttons.some((b) => decodeCallbackData(b?.callback_data)?.action === ACTION.ORIGIN);
  const scope = isGroupedMessage(query.message) ? "grouped" : "flat";

  if (payload.action === ACTION.ASK) {
    return payload.holder === query.from.id ? `${scope}:ask-self` : `${scope}:ask-other`;
  }
  if (payload.action === ACTION.NOTIFY) {
    return inMirror ? "mirror:act" : `${scope}:notify`;
  }
  if (payload.action === ACTION.RESOURCE || payload.action === ACTION.GROUPED_RESOURCE) {
    return inMirror ? "mirror:act" : `${scope}:${payload.busy ? "release" : "take"}`;
  }
  return null;
}

const me = await call("getMe");
if (!me.ok) {
  console.error("getMe не прошёл");
  process.exit(1);
}
await call("deleteWebhook");

say(`Бот @${me.result.username} работает локально. Что прожать:\n`);
for (const [, label] of CHECKLIST) say(`   ☐ ${label}`);
say(`
Подсказка по порядку:
   /create alpha beta
   → жми alpha (занять), ⚡, alpha (освободить), снова alpha, потом 🙇 на alpha
   → в личке: нажми ресурс в копии; повтори 🙇 и нажми ❌ Закрыть
   /board
   group/subgroup: 1 2
   another: testing
   → те же кнопки на сгруппированной доске
   /create            ← подсказка
   /board мусор       ← жалоба
   /other             ← пришлёт доски, где ресурс держит другой (для 🙇 чужому)
   /stale             ← пришлёт кнопку с испорченными данными

   Внимание: копия в личку по замыслу не шлётся, если доска и так в личке.
   Сценарии "копия: ..." закроются только с доской в группе — добавь бота
   в тестовую группу и создай доску там.

Ctrl+C — закончить и показать итог.
`);

// Дальше свой вывод только через say: обработчик логирует апдейты в console.log.
console.log = () => {};

// Сбрасываем накопившиеся апдейты: старые нажатия уже протухли, а их разбор
// только путает картину.
let offset = 0;
const backlog = await call("getUpdates", { offset: -1, timeout: 0 });
const lastSeen = backlog.result?.at(-1)?.update_id;
if (lastSeen !== undefined) {
  offset = lastSeen + 1;
  say("   (старые апдейты пропущены)\n");
}

let admin = process.env.CHAT_ID;

function summary() {
  say(`\n\nИтог: ${done.size} из ${CHECKLIST.length} сценариев`);
  for (const [key, label] of CHECKLIST) say(`   ${done.has(key) ? "✔" : "☐"} ${label}`);
  say(failures.length === 0 ? "\nОтказов Bot API не было." : `\nОтказы Bot API (${failures.length}):`);
  for (const detail of new Set(failures)) say(`   ✖ ${detail}`);
  process.exit(0);
}

process.on("SIGINT", summary);

// Прогон завершится сам: когда чек-лист закрыт или когда истечёт полчаса.
const stopAt = Date.now() + 30 * 60 * 1000;

while (Date.now() < stopAt) {
  const updates = await call("getUpdates", { offset, timeout: 25 });

  for (const update of updates.result ?? []) {
    offset = update.update_id + 1;
    admin ??= update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;

    const helper = HELPERS[update.message?.text?.trim()];
    if (helper) {
      say(`\n→ подпорка ${update.message.text.trim()}`);
      await helper(update.message.chat.id);
      continue;
    }

    const scenario = classify(update);
    say(`\n→ ${scenario ?? "апдейт вне сценариев"}`);

    await onRequest({
      params: { path: `bot${token}` },
      env: { BOT_TOKEN: token, BOT_ADMIN: admin },
      request: { json: async () => update },
    });

    mark(scenario);

    if (done.size === CHECKLIST.length) {
      summary();
    }
  }
}

say("\nПолчаса прошло.");
summary();
