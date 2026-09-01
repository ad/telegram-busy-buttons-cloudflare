// Невидимые символы, которыми в Telegram иногда «прячут» имя: обычные пробелы,
// NBSP, Hangul Filler и компания. Имя из них одних считаем отсутствующим.
const INVISIBLE = /[\s\u00A0\u3164\uFFA0\u2000-\u200F\u2028\u2029]/g;

export function hasVisibleText(value) {
  return String(value ?? "").replace(INVISIBLE, "").length > 0;
}

/**
 * Как подписать пользователя на кнопке и в уведомлениях:
 * имя и фамилия → @username → id.
 */
export function displayName(user) {
  if (!user) {
    return "";
  }

  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  if (hasVisibleText(fullName)) {
    return fullName;
  }

  if (user.username) {
    return `@${user.username}`;
  }

  return `id${user.id}`;
}
