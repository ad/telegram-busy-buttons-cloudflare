import {
  SUBSCRIPTION,
  buttonText,
  createBoard,
  invalidResourceNames,
  parseBoard,
  renderBoard,
  toggleResource,
  toggleSubscription,
} from "../utils/board.js";
import { ACTION, decodeCallbackData } from "../utils/codec.js";
import { MESSAGES } from "../utils/messages.js";
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

  if (!command.startsWith("/create")) {
    // Всё, кроме /create и /start, боту не адресовано.
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
    case ACTION.RESOURCE:
      return handleResource(ctx, query, payload);
    default:
      console.error("unknown callback data", query.data);
      return answer(ctx, query, MESSAGES.unknownButton);
  }
}

async function handleAsk(ctx, query, payload) {
  if (payload.holder === query.from.id) {
    return answer(ctx, query, MESSAGES.askYourself);
  }

  const sent = await ctx.telegram.sendMessage({
    chatId: payload.holder,
    text: MESSAGES.askToRelease(displayName(query.from), payload.name),
  });

  return answer(ctx, query, sent.ok ? MESSAGES.askSent : MESSAGES.askFailed);
}

async function handleNotify(ctx, query) {
  const { board, result } = toggleSubscription(parseBoard(query.message.reply_markup?.inline_keyboard), query.from.id);

  if (result === SUBSCRIPTION.FULL) {
    return answer(ctx, query, MESSAGES.notificationsFull(board.subscribers.length));
  }

  await redraw(ctx, query.message, board);

  return answer(
    ctx,
    query,
    result === SUBSCRIPTION.ENABLED ? MESSAGES.notificationsEnabled : MESSAGES.notificationsDisabled
  );
}

async function handleResource(ctx, query, payload) {
  const { board, resource, action } = toggleResource(
    parseBoard(query.message.reply_markup?.inline_keyboard),
    payload.name,
    query.from
  );

  if (!action) {
    console.error("resource is missing from the board", payload.name);
    return answer(ctx, query, MESSAGES.unknownButton);
  }

  await redraw(ctx, query.message, board);
  await notifySubscribers(ctx, board.subscribers, query.from, action, resource.name);

  return answer(ctx, query, MESSAGES.resourceUpdated(buttonText(resource)));
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
