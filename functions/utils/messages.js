import { MAX_RESOURCE_NAME_BYTES } from "./codec.js";

export const MESSAGES = {
  usage: "send command in format /create name1 name2 nameN",

  nameTooLong: (names) =>
    `Слишком длинные имена: ${names.join(", ")}. Максимум ${MAX_RESOURCE_NAME_BYTES} байт на имя.`,

  askYourself: "Ты только что попросил себя освободить. Попробуй договориться с зеркалом.",
  askToRelease: (who, name) => `Пользователь ${who} просит освободить "${name}" если уже не нужно.`,
  askSent: "Запрос отправлен",
  askFailed: "Не удалось отправить запрос — возможно, пользователь не начинал диалог с ботом",

  notificationsEnabled: "Notifications enabled",
  notificationsDisabled: "Notifications disabled",
  notificationsFull: (limit) => `Список подписчиков переполнен: максимум ${limit} для одного сообщения`,

  resourceUpdated: (name) => `${name} updated`,
  resourceTaken: "занимает",
  resourceReleased: "освобождает",
  notification: (who, action, name) => `${who} ${action} ${name}`,

  unknownButton: "Кнопка устарела — создайте сообщение заново",
  emptyBoard: "Нет ресурсов",
};
