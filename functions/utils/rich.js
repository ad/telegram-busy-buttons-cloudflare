/**
 * Rich messages (Bot API 10.1): разметка на отправку и разбор блоков на приём.
 *
 * Кнопки rich-сообщения живут не в reply_markup, а в содержимом — блоками
 * "buttons". Поэтому состояние доски читается отсюда, а не из клавиатуры.
 */

/** Из именованных сущностей Telegram принимает ограниченный набор; эти в него входят. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** RichText — это строка, массив RichText или узел с вложенным text. */
export function richTextToPlain(node) {
  if (typeof node === "string") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(richTextToPlain).join("");
  }
  if (node && typeof node === "object") {
    return richTextToPlain(node.text);
  }
  return "";
}

/** Кнопки сообщения в едином виде — неважно, rich оно или обычное. */
export function messageButtons(message) {
  if (message?.rich_message) {
    return (message.rich_message.blocks || [])
      .filter((block) => block?.type === "buttons")
      .flatMap((block) => block.buttons || [])
      .map((button) => ({ text: richTextToPlain(button.text), callback_data: button.callback_data }));
  }

  return (message?.reply_markup?.inline_keyboard || []).flat();
}

/** Инлайн-клавиатура как разметка: каждый ряд — <tg-button-row>. */
export function buttonRows(keyboard) {
  return (keyboard || [])
    .map((row) => `<tg-button-row>${row.map(button).join("")}</tg-button-row>`)
    .join("");
}

function button({ text, style, callback_data }) {
  const styleAttr = style ? ` style="${escapeAttr(style)}"` : "";
  return `<tg-button type="callback_data"${styleAttr} data="${escapeAttr(callback_data)}">${escapeHtml(text)}</tg-button>`;
}
