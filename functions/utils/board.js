/**
 * Доска ресурсов — целиком выводится из inline-клавиатуры сообщения и обратно
 * в неё же рендерится. Никакого хранилища: сообщение и есть состояние.
 *
 *   Board = { resources: [{ name, busy, holder, holderLabel }], subscribers: number[], origin }
 *
 * origin заполнен только у копии доски, отправленной в личку: он указывает на
 * исходное сообщение, которое нужно обновить вместе с копией.
 */

import {
  ACTION,
  MAX_RESOURCE_NAME_BYTES,
  byteLength,
  decodeCallbackData,
  encodeAsk,
  encodeNotify,
  encodeOrigin,
  encodeResource,
  fitsCallbackData,
} from "./codec.js";
import { MESSAGES } from "./messages.js";
import { displayName } from "./user.js";

export const ICON = { FREE: "🟢", BUSY: "🏗️", ASK: "🙇", NOTIFY: "⚡" };

export const STYLE = { FREE: "success", BUSY: "danger", ASK: "primary" };

export const SUBSCRIPTION = { ENABLED: "enabled", DISABLED: "disabled", FULL: "full" };

export const RESOURCE_ACTION = { TAKEN: "taken", RELEASED: "released" };

// Кнопки старых версий несли иконку в тексте; сейчас иконки только в тексте сообщения.
const LEADING_ICON = /^(?:🟢|🏗️)\s*/u;

export function createBoard(names) {
  const unique = [...new Set(names)];
  return {
    resources: unique.map((name) => ({ name, busy: false, holder: null, holderLabel: "" })),
    subscribers: [],
    origin: null,
  };
}

export function parseBoard(inlineKeyboard) {
  const resources = [];
  let subscribers = [];
  let origin = null;

  for (const button of (inlineKeyboard || []).flat()) {
    const payload = decodeCallbackData(button?.callback_data);
    if (!payload) {
      continue;
    }

    if (payload.action === ACTION.NOTIFY) {
      subscribers = payload.subscribers;
    } else if (payload.action === ACTION.ORIGIN) {
      origin = { chatId: payload.chatId, messageId: payload.messageId };
    } else if (payload.action === ACTION.RESOURCE) {
      resources.push({
        name: payload.name,
        busy: payload.busy,
        holder: payload.holder,
        // Кто занял — знает только текст кнопки, в callback_data подписи нет.
        holderLabel: payload.busy ? holderLabelFrom(button.text, payload.name) : "",
      });
    }
    // Кнопки "🙇" состояния не несут — они пересобираются при рендере.
  }

  return { resources, subscribers, origin };
}

function holderLabelFrom(text, name) {
  const stripped = String(text ?? "").replace(LEADING_ICON, "").trim();
  return stripped.startsWith(name) ? stripped.slice(name.length).trim() : "";
}

export function renderBoard(board) {
  const inline_keyboard = board.resources.map((resource) => {
    const row = [resourceButton(resource)];
    if (resource.busy && resource.holder != null) {
      row.push(askButton(resource));
    }
    return row;
  });

  inline_keyboard.push([notifyButton(board.subscribers)]);

  if (board.origin) {
    inline_keyboard.push([originButton(board.origin)]);
  }

  return { text: boardText(board), inline_keyboard };
}

/** Копия доски для лички: та же клавиатура плюс указатель на исходное сообщение. */
export function mirrorOf(board, message) {
  return { ...board, origin: { chatId: message.chat.id, messageId: message.message_id } };
}

export function boardText(board) {
  if (board.resources.length === 0) {
    return MESSAGES.emptyBoard;
  }
  return board.resources.map((r) => `${r.busy ? ICON.BUSY : ICON.FREE}${r.name}`).join(" ");
}

export function buttonText(resource) {
  return resource.busy && resource.holderLabel ? `${resource.name} ${resource.holderLabel}` : resource.name;
}

function resourceButton(resource) {
  return {
    text: buttonText(resource),
    style: resource.busy ? STYLE.BUSY : STYLE.FREE,
    callback_data: encodeResource(resource),
  };
}

function askButton(resource) {
  return {
    text: ICON.ASK,
    style: STYLE.ASK,
    callback_data: encodeAsk(resource),
  };
}

function originButton(origin) {
  return { text: MESSAGES.closeMirror, callback_data: encodeOrigin(origin) };
}

function notifyButton(subscribers) {
  return {
    text: subscribers.length > 0 ? `${ICON.NOTIFY} ${subscribers.length}` : ICON.NOTIFY,
    callback_data: encodeNotify(subscribers),
  };
}

/**
 * Занять свободный ресурс или освободить занятый.
 * action === null, если такого ресурса на доске нет.
 */
export function toggleResource(board, name, user) {
  const index = board.resources.findIndex((resource) => resource.name === name);
  if (index === -1) {
    return { board, resource: null, action: null };
  }

  const current = board.resources[index];
  const next = current.busy
    ? { ...current, busy: false, holder: null, holderLabel: "" }
    : { ...current, busy: true, holder: user.id, holderLabel: displayName(user) };

  const resources = [...board.resources];
  resources[index] = next;

  return {
    board: { ...board, resources },
    resource: next,
    action: current.busy ? RESOURCE_ACTION.RELEASED : RESOURCE_ACTION.TAKEN,
  };
}

/**
 * Подписаться на уведомления или отписаться. Список подписчиков живёт в
 * callback_data кнопки "⚡", поэтому упирается в 64 байта: когда места больше
 * нет, возвращаем FULL и доску не трогаем — молча терять подписчика хуже.
 */
export function toggleSubscription(board, userId) {
  if (board.subscribers.includes(userId)) {
    const subscribers = board.subscribers.filter((id) => id !== userId);
    return { board: { ...board, subscribers }, result: SUBSCRIPTION.DISABLED };
  }

  const subscribers = [...board.subscribers, userId];
  if (!fitsCallbackData(encodeNotify(subscribers))) {
    return { board, result: SUBSCRIPTION.FULL };
  }

  return { board: { ...board, subscribers }, result: SUBSCRIPTION.ENABLED };
}

export function invalidResourceNames(names) {
  return names.filter((name) => byteLength(name) > MAX_RESOURCE_NAME_BYTES);
}
