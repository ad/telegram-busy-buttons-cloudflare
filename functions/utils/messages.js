import { MAX_RESOURCE_NAME_BYTES } from "./codec.js";
import { escapeHtml } from "./rich.js";

export const MESSAGES = {
  usage: "send command in format /create name1 name2 nameN",

  nameTooLong: (names) =>
    `Слишком длинные имена: ${names.join(", ")}. Максимум ${MAX_RESOURCE_NAME_BYTES} байт на имя.`,

  askYourself: "Ты только что попросил себя освободить. Попробуй договориться с зеркалом.",

  // Единственное место, где бот использует rich message: сообщение редкое,
  // поэтому служит площадкой для обкатки разметки.
  askYourselfDetails: (name) =>
    [
      "<h3>Зеркало не отвечает</h3>",
      `<p>Ресурс <code>${escapeHtml(name)}</code> занят тобой же — просьба освободить пришла бы тебе.</p>`,
      "<blockquote expandable>Ты нажал «попросить освободить» на кнопке, которую держишь сам. " +
        "Бот честно попытался доставить просьбу и обнаружил, что адресат уже читает это сообщение." +
        "<cite>Отдел рекурсивных запросов</cite></blockquote>",
      "<hr/>",
      `<p>Доска ниже — снимок из чата. Освободи <code>${escapeHtml(name)}</code> прямо отсюда, ` +
        "исходное сообщение обновится.</p>",
      "<footer>Кнопки ниже управляют доской в исходном чате.</footer>",
    ].join(""),

  askToRelease: (who, name) => `Пользователь ${who} просит освободить "${name}" если уже не нужно.`,
  askSent: "Запрос отправлен",
  askFailed: "Не удалось отправить запрос — возможно, пользователь не начинал диалог с ботом",

  closeMirror: "❌ Закрыть",
  mirrorClosed: "<p><i>Копия закрыта.</i></p>",
  mirrorClosedAnswer: "Копия закрыта",

  // Копия перерисовывается после каждого действия: видно, что произошло,
  // и не тянет нажать ещё раз «на всякий случай».
  mirrorApplied: (headline, board) =>
    [
      `<h3>${escapeHtml(headline)}</h3>`,
      "<p>Исходное сообщение обновлено.</p>",
      `<blockquote>${escapeHtml(board)}</blockquote>`,
    ].join(""),
  mirrorResourceHeadline: (name, action) => `${name} — ${MESSAGES.resourceResult[action]}`,

  notificationsEnabled: "Notifications enabled",
  notificationsDisabled: "Notifications disabled",
  notificationsFull: (limit) => `Список подписчиков переполнен: максимум ${limit} для одного сообщения`,

  resourceUpdated: (name) => `${name} updated`,
  resourceVerb: { taken: "занимает", released: "освобождает" },
  resourceResult: { taken: "занят", released: "освобождён" },
  notification: (who, action, name) => `${who} ${MESSAGES.resourceVerb[action]} ${name}`,

  unknownButton: "Кнопка устарела — создайте сообщение заново",
  emptyBoard: "Нет ресурсов",
};
