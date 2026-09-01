/**
 * Сгруппированная доска: ресурсы разложены по проектам.
 *
 *   GroupedBoard = { groups: [{ name, resources: [...] }], subscribers, origin }
 *
 * Живёт целиком в rich-сообщении, без reply_markup: заголовки групп — блоки
 * "heading", кнопки — блоки "buttons". Оба приезжают обратно в callback_query,
 * поэтому доска восстанавливается из собственного сообщения.
 *
 * Плоская доска (/create) устроена иначе и живёт в board.js — они не смешиваются.
 */

import { ICON, RESOURCE_ACTION, STYLE } from "./board.js";
import {
  ACTION,
  MAX_GROUPED_NAME_BYTES,
  byteLength,
  decodeCallbackData,
  encodeGroupedAsk,
  encodeGroupedResource,
  encodeNotify,
  encodeOrigin,
} from "./codec.js";
import { MESSAGES } from "./messages.js";
import { buttonRows, escapeHtml, messageButtons, richTextToPlain } from "./rich.js";
import { displayName } from "./user.js";

const LEADING_ICON = /^(?:🟢|🏗️)\s*/u;

/** Разбирает тело команды: одна строка — одна группа, "имя: ресурс1 ресурс2". */
export function parseGroupsCommand(text) {
  const groups = [];
  const invalid = [];

  for (const raw of text.replace(/^\/\S*/, "").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }

    // Двоеточие бывает внутри имени группы — режем по первому.
    const at = line.indexOf(":");
    const name = at === -1 ? "" : line.slice(0, at).trim();
    const items = at === -1 ? [] : line.slice(at + 1).trim().split(/\s+/).filter(Boolean);

    if (name === "" || items.length === 0) {
      invalid.push(line);
    } else {
      groups.push({ name, items });
    }
  }

  return { groups, invalid };
}

/** Сгруппированная доска узнаётся по кнопкам: у плоской таких payload'ов нет. */
export function isGroupedMessage(message) {
  return messageButtons(message).some(
    (button) => decodeCallbackData(button?.callback_data)?.action === ACTION.GROUPED_RESOURCE
  );
}

export function createGroupedBoard(groups) {
  return {
    groups: groups.map((group) => ({
      name: group.name,
      resources: [...new Set(group.items)].map((name) => ({
        name,
        busy: false,
        holder: null,
        holderLabel: "",
      })),
    })),
    subscribers: [],
    origin: null,
  };
}

export function invalidGroupedNames(groups) {
  return groups.flatMap((group) => group.items.filter((name) => byteLength(name) > MAX_GROUPED_NAME_BYTES));
}

/**
 * Восстанавливает доску из блоков сообщения. Группой считается заголовок, к
 * которому прицепились кнопки ресурсов: посторонний <h3> в тексте сообщения
 * группой не станет и индексы не сдвинет.
 */
export function parseGroupedBoard(blocks) {
  const groups = [];
  let current = null;
  let subscribers = [];
  let origin = null;

  for (const block of blocks || []) {
    if (block?.type === "heading") {
      current = { name: richTextToPlain(block.text), resources: [] };
      groups.push(current);
      continue;
    }

    if (block?.type !== "buttons") {
      continue;
    }

    for (const button of block.buttons || []) {
      const payload = decodeCallbackData(button?.callback_data);

      if (payload?.action === ACTION.NOTIFY) {
        subscribers = payload.subscribers;
      } else if (payload?.action === ACTION.ORIGIN) {
        origin = { chatId: payload.chatId, messageId: payload.messageId };
      } else if (payload?.action === ACTION.GROUPED_RESOURCE && current) {
        current.resources.push({
          name: payload.name,
          busy: payload.busy,
          holder: payload.holder,
          holderLabel: payload.busy ? holderLabelFrom(richTextToPlain(button.text), payload.name) : "",
        });
      }
    }
  }

  return { groups: groups.filter((group) => group.resources.length > 0), subscribers, origin };
}

function holderLabelFrom(text, name) {
  const stripped = String(text ?? "").replace(LEADING_ICON, "").trim();
  return stripped.startsWith(name) ? stripped.slice(name.length).trim() : "";
}

/** Доска целиком как разметка rich-сообщения. */
export function renderGroupedBoard(board) {
  const parts = board.groups.map(
    (group, index) => `<h3>${escapeHtml(group.name)}</h3>${buttonRows(groupRows(group, index))}`
  );

  parts.push(buttonRows([[notifyButton(board.subscribers)]]));

  if (board.origin) {
    parts.push(buttonRows([[originButton(board.origin)]]));
  }

  return parts.join("");
}

function groupRows(group, index) {
  return group.resources.map((resource) => {
    const payload = { ...resource, group: index };
    const row = [
      {
        text: resourceText(resource),
        style: resource.busy ? STYLE.BUSY : STYLE.FREE,
        callback_data: encodeGroupedResource(payload),
      },
    ];

    if (resource.busy && resource.holder != null) {
      row.push({ text: ICON.ASK, style: STYLE.ASK, callback_data: encodeGroupedAsk(payload) });
    }

    return row;
  });
}

export function resourceText(resource) {
  return resource.busy && resource.holderLabel ? `${resource.name} ${resource.holderLabel}` : resource.name;
}

/** Состояние доски строками — там, где кнопок уже нет. */
export function groupedBoardText(board) {
  return board.groups.map((group) => {
    const resources = group.resources.map((r) => `${r.busy ? ICON.BUSY : ICON.FREE}${r.name}`).join(" ");
    return `${group.name}: ${resources}`;
  });
}

/** Как ресурс называется за пределами своей группы: в уведомлениях и всплывашках. */
export function groupedLabel(groupName, resourceName) {
  return `${groupName}/${resourceName}`;
}

function notifyButton(subscribers) {
  return {
    text: subscribers.length > 0 ? `${ICON.NOTIFY} ${subscribers.length}` : ICON.NOTIFY,
    callback_data: encodeNotify(subscribers),
  };
}

function originButton(origin) {
  return { text: MESSAGES.closeMirror, callback_data: encodeOrigin(origin) };
}

export function toggleGroupedResource(board, groupIndex, name, user) {
  const group = board.groups[groupIndex];
  const index = group ? group.resources.findIndex((resource) => resource.name === name) : -1;

  if (index === -1) {
    return { board, group: null, resource: null, action: null };
  }

  const current = group.resources[index];
  const next = current.busy
    ? { ...current, busy: false, holder: null, holderLabel: "" }
    : { ...current, busy: true, holder: user.id, holderLabel: displayName(user) };

  const resources = [...group.resources];
  resources[index] = next;

  const groups = [...board.groups];
  groups[groupIndex] = { ...group, resources };

  return {
    board: { ...board, groups },
    group,
    resource: next,
    action: current.busy ? RESOURCE_ACTION.RELEASED : RESOURCE_ACTION.TAKEN,
  };
}

export function groupedMirrorOf(board, message) {
  return { ...board, origin: { chatId: message.chat.id, messageId: message.message_id } };
}
