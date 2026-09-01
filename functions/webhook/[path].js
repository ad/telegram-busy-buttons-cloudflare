import {
  SUBSCRIPTION,
  boardText,
  buttonText,
  createBoard,
  invalidResourceNames,
  mirrorOf,
  parseBoard,
  renderBoard,
  toggleResource,
  toggleSubscription,
} from "../utils/board.js";
import { ACTION, decodeCallbackData } from "../utils/codec.js";
import {
  createGroupedBoard,
  groupedBoardText,
  groupedLabel,
  groupedMirrorOf,
  invalidGroupedNames,
  isGroupedMessage,
  parseGroupedBoard,
  parseGroupsCommand,
  renderGroupedBoard,
  resourceText,
  toggleGroupedResource,
} from "../utils/groups.js";
import { MESSAGES } from "../utils/messages.js";
import { buttonRows, messageBlocks, messageButtons } from "../utils/rich.js";
import { Telegram } from "../utils/telegram.js";
import { displayName } from "../utils/user.js";

const OK = () => new Response("ok", { status: 200 });

export async function onRequest(context) {
  const { env, params, request } = context;

  // Путь вебхука содержит токен — всё остальное молча игнорируем.
  if (params.path !== `bot${env.BOT_TOKEN}`) {
    return OK();
  }

  const telegram = new Telegram(env.BOT_TOKEN);

  try {
    const update = await request.json();
    await handleUpdate({ env, telegram }, update);
  } catch (error) {
    console.error("update failed", error);
    await reportToAdmin({ env, telegram }, error);
  }

  return OK();
}

async function handleUpdate(ctx, update) {
  console.log("update", update);

  if (isDebugEnabled(ctx.env)) {
    await ctx.telegram.sendMessage({ chatId: ctx.env.BOT_ADMIN, text: describeUpdate(update) });
  }

  if (update.callback_query) {
    return handleCallbackQuery(ctx, update.callback_query);
  }

  if (update.message?.text) {
    return handleMessage(ctx, update.message);
  }
}

/* ------------------------------- сообщения ------------------------------- */

async function handleMessage(ctx, message) {
  const [command, ...names] = message.text.trim().split(/\s+/);

  if (command.startsWith("/board")) {
    return handleBoardCommand(ctx, message);
  }

  if (!command.startsWith("/create")) {
    // Всё, кроме /board, /create и /start, боту не адресовано.
    if (command.startsWith("/start")) {
      await replyUsage(ctx, message);
    }
    return;
  }

  if (names.length === 0) {
    return replyUsage(ctx, message);
  }

  const tooLong = invalidResourceNames(names);
  if (tooLong.length > 0) {
    return reply(ctx, message, MESSAGES.nameTooLong(tooLong));
  }

  const { text, inline_keyboard } = renderBoard(createBoard(names));

  return ctx.telegram.sendMessage({
    chatId: message.chat.id,
    threadId: message.message_thread_id,
    text,
    keyboard: inline_keyboard,
  });
}

/** Сгруппированная доска: rich-сообщение целиком, без reply_markup. */
async function handleBoardCommand(ctx, message) {
  const { groups, invalid } = parseGroupsCommand(message.text);

  if (invalid.length > 0) {
    return reply(ctx, message, MESSAGES.boardBadLines(invalid));
  }

  if (groups.length === 0) {
    return reply(ctx, message, MESSAGES.boardUsage);
  }

  const tooLong = invalidGroupedNames(groups);
  if (tooLong.length > 0) {
    return reply(ctx, message, MESSAGES.boardNameTooLong(tooLong));
  }

  return ctx.telegram.sendRichMessage({
    chatId: message.chat.id,
    threadId: message.message_thread_id,
    html: renderGroupedBoard(createGroupedBoard(groups)),
  });
}

function replyUsage(ctx, message) {
  return reply(ctx, message, MESSAGES.usage);
}

function reply(ctx, message, text) {
  return ctx.telegram.sendMessage({
    chatId: message.chat.id,
    threadId: message.message_thread_id,
    text,
  });
}

/* --------------------------------- кнопки -------------------------------- */

async function handleCallbackQuery(ctx, query) {
  const payload = decodeCallbackData(query.data);

  switch (payload?.action) {
    case ACTION.ASK:
      return handleAsk(ctx, query, payload);
    case ACTION.NOTIFY:
      return handleNotify(ctx, query);
    case ACTION.ORIGIN:
      return handleCloseMirror(ctx, query);
    case ACTION.RESOURCE:
      return handleResource(ctx, query, payload);
    case ACTION.GROUPED_RESOURCE:
      return handleGroupedResource(ctx, query, payload);
    default:
      console.error("unknown callback data", query.data);
      return answer(ctx, query, MESSAGES.unknownButton);
  }
}

async function handleAsk(ctx, query, payload) {
  const grouped = payload.group == null ? null : parseGroupedBoard(messageBlocks(query.message));
  const groupName = grouped?.groups[payload.group]?.name;
  const label = groupName ? groupedLabel(groupName, payload.name) : payload.name;

  if (payload.holder === query.from.id) {
    await sendSelfReleaseMirror(ctx, query, label, grouped);
    return answer(ctx, query, MESSAGES.askYourself);
  }

  const sent = await ctx.telegram.sendMessage({
    chatId: payload.holder,
    text: MESSAGES.askToRelease(displayName(query.from), label),
  });

  return answer(ctx, query, sent.ok ? MESSAGES.askSent : MESSAGES.askFailed);
}

/**
 * Просьба освободить ресурс, который ты держишь сам: кроме шутки во всплывашке
 * присылаем в личку копию доски, с которой ресурс можно отпустить сразу.
 *
 * Копия несёт полный снимок доски, потому что editMessageText требует прислать
 * клавиатуру целиком, а прочитать исходное сообщение бот не может.
 */
async function sendSelfReleaseMirror(ctx, query, name, groupedBoard) {
  // В личке доска и так под рукой — вторая копия там не нужна.
  if (query.message.chat.id === query.from.id) {
    return;
  }

  const board = groupedBoard ?? parseBoard(messageButtons(query.message));
  const mirror = groupedBoard
    ? renderGroupedBoard(groupedMirrorOf(board, query.message))
    : mirrorButtons(mirrorOf(board, query.message));

  await ctx.telegram.sendRichMessage({
    chatId: query.from.id,
    html: MESSAGES.askYourselfDetails(name) + mirror,
  });
}

/** Клавиатура копии живёт в разметке: <tg-button-row> вместо reply_markup. */
function mirrorButtons(board) {
  return buttonRows(renderBoard(board).inline_keyboard);
}

async function handleCloseMirror(ctx, query) {
  await ctx.telegram.editMessageText({
    chatId: query.message.chat.id,
    messageId: query.message.message_id,
    html: MESSAGES.mirrorClosed,
  });

  return answer(ctx, query, MESSAGES.mirrorClosedAnswer);
}

async function handleNotify(ctx, query) {
  // Кнопка "⚡" одна и та же у обеих досок, а перерисовываются они по-разному.
  const grouped = isGroupedMessage(query.message);
  const current = grouped
    ? parseGroupedBoard(messageBlocks(query.message))
    : parseBoard(messageButtons(query.message));

  const { board, result } = toggleSubscription(current, query.from.id);

  if (result === SUBSCRIPTION.FULL) {
    return answer(ctx, query, MESSAGES.notificationsFull(board.subscribers.length));
  }

  const headline =
    result === SUBSCRIPTION.ENABLED ? MESSAGES.notificationsEnabled : MESSAGES.notificationsDisabled;

  // Всплывашка живёт считаные секунды — отвечаем сразу, не дожидаясь правок.
  const answered = answer(ctx, query, headline);

  await (grouped ? applyGroupedChange : applyChange)(ctx, query.message, board, headline);

  return answered;
}

async function handleResource(ctx, query, payload) {
  const { board, resource, action } = toggleResource(
    parseBoard(messageButtons(query.message)),
    payload.name,
    query.from
  );

  if (!action) {
    console.error("resource is missing from the board", payload.name);
    return answer(ctx, query, MESSAGES.unknownButton);
  }

  const answered = answer(ctx, query, MESSAGES.resourceUpdated(buttonText(resource)));

  await applyChange(ctx, query.message, board, MESSAGES.mirrorResourceHeadline(resource.name, action));
  await notifySubscribers(ctx, board.subscribers, query.from, action, resource.name);

  return answered;
}

async function handleGroupedResource(ctx, query, payload) {
  const { board, group, resource, action } = toggleGroupedResource(
    parseGroupedBoard(messageBlocks(query.message)),
    payload.group,
    payload.name,
    query.from
  );

  if (!action) {
    console.error("grouped resource is missing from the board", payload);
    return answer(ctx, query, MESSAGES.unknownButton);
  }

  const label = groupedLabel(group.name, resource.name);
  const answered = answer(ctx, query, MESSAGES.resourceUpdated(resourceText(resource)));

  await applyGroupedChange(ctx, query.message, board, MESSAGES.mirrorResourceHeadline(label, action));
  await notifySubscribers(ctx, board.subscribers, query.from, action, label);

  return answered;
}

/** То же, что applyChange, но доска рендерится разметкой, а не клавиатурой. */
async function applyGroupedChange(ctx, message, board, headline) {
  if (!board.origin) {
    return ctx.telegram.editMessageText({
      chatId: message.chat.id,
      messageId: message.message_id,
      html: renderGroupedBoard(board),
    });
  }

  await ctx.telegram.editMessageText({
    chatId: board.origin.chatId,
    messageId: board.origin.messageId,
    html: renderGroupedBoard({ ...board, origin: null }),
  });

  await ctx.telegram.editMessageText({
    chatId: message.chat.id,
    messageId: message.message_id,
    html: MESSAGES.mirrorApplied(headline, groupedBoardText(board)),
  });
}

/**
 * Применяет изменение доски. Нажатие в копии из лички обновляет исходное
 * сообщение и гасит саму копию: результат виден, а кнопок больше нет —
 * повторно нажать и затереть чужие изменения устаревшим снимком нельзя.
 */
async function applyChange(ctx, message, board, headline) {
  if (!board.origin) {
    return redraw(ctx, message, board);
  }

  const { text, inline_keyboard } = renderBoard({ ...board, origin: null });

  await ctx.telegram.editMessageText({
    chatId: board.origin.chatId,
    messageId: board.origin.messageId,
    text,
    keyboard: inline_keyboard,
  });

  await ctx.telegram.editMessageText({
    chatId: message.chat.id,
    messageId: message.message_id,
    html: MESSAGES.mirrorApplied(headline, [boardText(board)]),
  });
}

function redraw(ctx, message, board) {
  const { text, inline_keyboard } = renderBoard(board);

  return ctx.telegram.editMessageText({
    chatId: message.chat.id,
    messageId: message.message_id,
    text,
    keyboard: inline_keyboard,
  });
}

function notifySubscribers(ctx, subscribers, actor, action, name) {
  const text = MESSAGES.notification(displayName(actor), action, name);

  return Promise.all(
    subscribers
      .filter((id) => id !== actor.id)
      .map((id) => ctx.telegram.sendMessage({ chatId: id, text }))
  );
}

function answer(ctx, query, text) {
  return ctx.telegram.answerCallbackQuery({ id: query.id, text });
}

/* ------------------------------- диагностика ------------------------------ */

function isDebugEnabled(env) {
  const value = String(env.BOT_DEBUG ?? "").toLowerCase();
  return value !== "" && value !== "false" && value !== "0";
}

function describeUpdate(update) {
  const message = update.message ?? update.edited_message;

  if (message) {
    const kind = update.edited_message ? "Edited message" : "Message";
    return [
      `${kind} from ${displayName(message.from)} (${message.from.id})`,
      `Chat id: ${message.chat.id}`,
      `Text: ${message.text}`,
    ].join("\n");
  }

  if (update.callback_query) {
    const query = update.callback_query;
    return [
      `Callback query from ${displayName(query.from)} (${query.from.id})`,
      `Chat id: ${query.message.chat.id}`,
      `Text: ${query.message.text}`,
      `Data: ${query.data}`,
    ].join("\n");
  }

  return JSON.stringify(update);
}

function reportToAdmin(ctx, error) {
  if (!ctx.env.BOT_ADMIN) {
    return;
  }
  return ctx.telegram.sendMessage({ chatId: ctx.env.BOT_ADMIN, text: String(error?.message ?? error) });
}
