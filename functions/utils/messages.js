import { MAX_GROUPED_NAME_BYTES, MAX_RESOURCE_NAME_BYTES } from "./codec.js";
import { escapeHtml } from "./rich.js";

export const MESSAGES = {
  usage: "send command in format /create name1 name2 nameN",

  nameTooLong: (names) =>
    `Слишком длинные имена: ${names.join(", ")}. Максимум ${MAX_RESOURCE_NAME_BYTES} байт на имя.`,

  boardUsage: [
    "Сгруппированная доска — по группе на строку:",
    "",
    "/board",
    "group/subgroup: 1 2 3 4",
    "one more-group: 1 2",
    "another: testing",
  ].join("\n"),
  boardBadLines: (lines) =>
    `Не понял строки: ${lines.join(" | ")}. Каждая строка должна быть вида "группа: ресурс1 ресурс2".`,
  boardNameTooLong: (names) =>
    `Слишком длинные имена: ${names.join(", ")}. Максимум ${MAX_GROUPED_NAME_BYTES} байт на имя в сгруппированной доске.`,

  askYourself: "Ты только что попросил себя освободить. Попробуй договориться с зеркалом.",

  // Шутка про зеркало — первая копия доски, с которой обкатывалась разметка;
  // просьба освободить и подтверждение захвата устроены так же.
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

  // Просьба освободить приходит держателю такой же копией доски: ресурс можно
  // отпустить прямо из лички, не возвращаясь в чат.
  askToReleaseDetails: (who, name) =>
    [
      "<h3>Просят освободить</h3>",
      `<p>${escapeHtml(who)} просит освободить <code>${escapeHtml(name)}</code>, если уже не нужен.</p>`,
      "<hr/>",
      `<p>Доска ниже — снимок из чата. Освободи <code>${escapeHtml(name)}</code> прямо отсюда, ` +
        "исходное сообщение обновится.</p>",
      "<footer>Кнопки ниже управляют доской в исходном чате.</footer>",
    ].join(""),

  askSent: "Запрос отправлен",
  askFailed: "Не удалось отправить запрос — возможно, пользователь не начинал диалог с ботом",

  // Подтверждение захвата: чужой ресурс освобождается не первым нажатием, а
  // вторым — в эфемерной копии доски, которую в общем чате видит только нажавший.
  takeoverDetails: (name, holder) =>
    [
      "<h3>Ресурс занят не тобой</h3>",
      `<p><code>${escapeHtml(name)}</code> занимает ${escapeHtml(holder)}.</p>`,
      "<hr/>",
      `<p>Доска ниже — снимок из чата, и видишь его только ты. Нажми <code>${escapeHtml(name)}</code>, ` +
        "чтобы всё-таки освободить ресурс, или закрой копию — тогда ничего не изменится.</p>",
      "<footer>Кнопки ниже управляют доской в общем чате.</footer>",
    ].join(""),
  takeoverAsked: (holder) => `${holder} ещё держит ресурс — подтверди ниже`,
  takeoverFailed: "Ресурс занят другим, а подтверждение показать не вышло — нажми ещё раз",
  unknownHolder: "кто-то ещё",

  closeMirror: "❌ Закрыть",
  mirrorClosed: "<p><i>Копия закрыта.</i></p>",
  mirrorClosedAnswer: "Копия закрыта",

  // Копия перерисовывается после каждого действия: видно, что произошло,
  // и не тянет нажать ещё раз «на всякий случай».
  // После действия копия становится терминальной: видно, что произошло, но
  // нажать ещё раз уже нельзя — устаревшим снимком не затрёшь чужие изменения.
  mirrorApplied: (headline, lines) =>
    [
      `<h3>${escapeHtml(headline)}</h3>`,
      "<p>Исходное сообщение обновлено.</p>",
      `<blockquote>${lines.map(escapeHtml).join("<br>")}</blockquote>`,
      "<footer>Эта копия больше не активна — дальше в исходном сообщении.</footer>",
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
