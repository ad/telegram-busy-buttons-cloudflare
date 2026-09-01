const UNESCAPE = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unescapeHtml = (value) => value.replace(/&(amp|lt|gt|quot|apos);/g, (m) => UNESCAPE[m]);

/**
 * Разбирает разметку, которую бот реально отправил, в блоки rich-сообщения —
 * ровно в том виде, в каком Telegram вернёт их в callback_query.message.
 */
export function richBlocks(html) {
  const blocks = [];

  for (const [, tag, body] of html.matchAll(/<(h3|tg-button-row)>(.*?)<\/\1>/g)) {
    if (tag === "h3") {
      blocks.push({ type: "heading", size: 3, text: unescapeHtml(body) });
      continue;
    }
    blocks.push({
      type: "buttons",
      buttons: [
        ...body.matchAll(/<tg-button type="callback_data"(?: style="([^"]*)")? data="([^"]*)">(.*?)<\/tg-button>/g),
      ].map((m) => ({ style: m[1], callback_data: unescapeHtml(m[2]), text: unescapeHtml(m[3]) })),
    });
  }

  return blocks;
}
