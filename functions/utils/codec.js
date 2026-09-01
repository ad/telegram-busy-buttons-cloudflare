/**
 * Кодирование состояния доски в callback_data кнопок.
 *
 * Хранилища у бота нет — всё состояние живёт в самих кнопках, поэтому каждый
 * payload обязан укладываться в жёсткий лимит Telegram: 64 байта на кнопку.
 * Пишем компактный формат ниже; старый JSON-формат по-прежнему читается, чтобы
 * сообщения, созданные предыдущими версиями бота, продолжали работать.
 *
 *   f|<name>            свободный ресурс
 *   b|<uid36>|<name>    занятый ресурс (uid может быть пустым — держатель неизвестен)
 *   a|<uid36>|<name>    просьба освободить ресурс
 *   n|<uid36>.<uid36>   подписчики на уведомления
 *   o|<chat36>|<msg36>  ссылка на исходную доску (только у копии доски в личке)
 */

export const CALLBACK_DATA_LIMIT = 64;

export const ACTION = {
  RESOURCE: "resource",
  ASK: "ask",
  NOTIFY: "notify",
  ORIGIN: "origin",
};

const encoder = new TextEncoder();

export function byteLength(value) {
  return encoder.encode(value).length;
}

export function fitsCallbackData(value) {
  return byteLength(value) <= CALLBACK_DATA_LIMIT;
}

// id пользователей Telegram — положительные целые; base36 короче десятичной записи на ~30%.
const USER_ID_PATTERN = /^[0-9a-z]+$/;
// 10 символов base36 покрывают id до 3.6e15 — с большим запасом к диапазону Telegram.
const USER_ID_MAX_CHARS = 10;

// Худший случай для имени — payload занятой кнопки "b|<uid>|<name>" и такой же по длине "a|...".
export const MAX_RESOURCE_NAME_BYTES =
  CALLBACK_DATA_LIMIT - "b|".length - USER_ID_MAX_CHARS - "|".length;

// id чата бывает отрицательным (группы и супергруппы), id пользователя — нет.
const CHAT_ID_PATTERN = /^-?[0-9a-z]+$/;

function encodeInt(value) {
  return Number(value).toString(36);
}

function decodeInt(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    return null;
  }
  const parsed = parseInt(value, 36);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function encodeUserId(id) {
  return id == null ? "" : Number(id).toString(36);
}

function decodeUserId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== "string" || !USER_ID_PATTERN.test(value)) {
    return null;
  }
  const id = parseInt(value, 36);
  return Number.isSafeInteger(id) ? id : null;
}

// Старые payload'ы хранили id в десятичном виде — их читаем как есть.
function decodeLegacyUserId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  }
  return null;
}

export function encodeResource({ name, busy, holder }) {
  return busy ? `b|${encodeUserId(holder)}|${name}` : `f|${name}`;
}

export function encodeAsk({ name, holder }) {
  return `a|${encodeUserId(holder)}|${name}`;
}

export function encodeNotify(subscribers) {
  return `n|${subscribers.map(encodeUserId).join(".")}`;
}

export function encodeOrigin({ chatId, messageId }) {
  return `o|${encodeInt(chatId)}|${encodeInt(messageId)}`;
}

function splitOnce(value) {
  const at = value.indexOf("|");
  return at === -1 ? [value, null] : [value.slice(0, at), value.slice(at + 1)];
}

export function decodeCallbackData(raw) {
  if (typeof raw !== "string" || raw === "") {
    return null;
  }

  const [kind, rest] = splitOnce(raw);
  if (rest === null) {
    return decodeLegacyCallbackData(raw);
  }

  switch (kind) {
    case "f":
      return rest === "" ? null : { action: ACTION.RESOURCE, name: rest, busy: false, holder: null };
    case "b": {
      const [id, name] = splitOnce(rest);
      if (!name) {
        return null;
      }
      return { action: ACTION.RESOURCE, name, busy: true, holder: id === "" ? null : decodeUserId(id) };
    }
    case "a": {
      const [id, name] = splitOnce(rest);
      const holder = decodeUserId(id);
      return !name || holder == null ? null : { action: ACTION.ASK, name, holder };
    }
    case "o": {
      const [chat, message] = splitOnce(rest);
      const chatId = decodeInt(chat, CHAT_ID_PATTERN);
      const messageId = decodeInt(message, USER_ID_PATTERN);
      return chatId == null || messageId == null ? null : { action: ACTION.ORIGIN, chatId, messageId };
    }
    case "n":
      return {
        action: ACTION.NOTIFY,
        subscribers: rest === "" ? [] : rest.split(".").map(decodeUserId).filter((id) => id != null),
      };
    default:
      return decodeLegacyCallbackData(raw);
  }
}

// В старом формате префикс "busy-" означал "нажатие займёт ресурс", то есть ресурс свободен.
const LEGACY_FREE_PREFIX = "busy-";
const LEGACY_BUSY_PREFIX = "free-";
const LEGACY_NOTIFY_PREFIX = "⚡";

function decodeLegacyCallbackData(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  if (data.a === "ask") {
    const holder = decodeLegacyUserId(data.t);
    const name = typeof data.b === "string" ? data.b : "";
    return holder == null || name === "" ? null : { action: ACTION.ASK, name, holder };
  }

  const command = typeof data.c === "string" ? data.c : typeof data.command === "string" ? data.command : null;
  if (command == null) {
    return null;
  }

  if (command.startsWith(LEGACY_NOTIFY_PREFIX)) {
    const subscribers = Array.isArray(data.n) ? data.n.map(decodeLegacyUserId).filter((id) => id != null) : [];
    return { action: ACTION.NOTIFY, subscribers };
  }

  if (command.startsWith(LEGACY_FREE_PREFIX)) {
    const name = command.slice(LEGACY_FREE_PREFIX.length);
    return name === "" ? null : { action: ACTION.RESOURCE, name, busy: false, holder: null };
  }

  if (command.startsWith(LEGACY_BUSY_PREFIX)) {
    const name = command.slice(LEGACY_BUSY_PREFIX.length);
    return name === "" ? null : { action: ACTION.RESOURCE, name, busy: true, holder: decodeLegacyUserId(data.u) };
  }

  return null;
}
