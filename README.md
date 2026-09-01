# telegram-busy-buttons-cloudflare

send `/create name1 name2 nameN` to bot

bot answers with message+buttons, now you can interact with it


### Demo

[@busybuttonsbot](https://t.me/busybuttonsbot)

## Structure

```
functions/
  webhook/[path].js   роутинг вебхука и обработчики апдейтов
  utils/
    board.js          доска ресурсов: разбор клавиатуры, переходы, рендер
    codec.js          упаковка состояния в callback_data (лимит Telegram — 64 байта)
    telegram.js       клиент Bot API
    user.js           подпись пользователя (имя → @username → id)
    messages.js       тексты, которые видит пользователь
test/                 тесты на node:test, без зависимостей
```

Состояние доски целиком лежит в кнопках сообщения — хранилища у бота нет.
Отсюда главное ограничение: каждый `callback_data` обязан уместиться в 64 байта.
Поэтому имя ресурса ограничено 51 байтом, а на одно сообщение помещается
9 подписчиков на уведомления; при переполнении бот отвечает отказом, а не ломает кнопки.

Если нажать 🙇 на ресурсе, который занят тобой же, бот дополнительно присылает в
личку копию доски с указателем на исходное сообщение (кнопка `❌ Закрыть` несёт
`chat_id` и `message_id`). Нажатие в копии обновляет исходную доску и гасит копию:
`editMessageText` требует прислать клавиатуру целиком, а прочитать чужое сообщение
бот не умеет — поэтому копия и есть снимок состояния.

Это сообщение — единственное, отправляемое через [rich message](https://core.telegram.org/bots/api#rich-messages)
(`sendRichMessage` c `rich_message.html`); оно редкое, поэтому служит площадкой для
обкатки разметки. Кнопки копии живут прямо в разметке — `<tg-button-row>` с
`<tg-button type="callback_data">`, — поэтому и снимок доски читается не из
`reply_markup`, а из `message.rich_message.blocks` (блоки `type: "buttons"`).
Этим занимается [rich.js](functions/utils/rich.js): `messageButtons()` достаёт
кнопки из любого сообщения, обычного или rich.

После каждого нажатия копия перерисовывается тем же `editMessageText`, но с
`rich_message` вместо `text`: заголовок говорит, что произошло, а кнопки
показывают новое состояние — не тянет нажать ещё раз.

## Tests

```
npm test
```

## Local run via wrangler

```
docker run --name Wrangler --rm \
    -p 8080:8080 \
    --env 'START_WRANGLER=true' \
    --env 'WRANGLER_START_CMD=wrangler pages dev ./ --port 8080 --ip 0.0.0.0' \
    --env 'UID=99' \
    --env 'GID=100' \
    --env 'UMASK=0000' \
    --env 'DATA_PERMS=770' \
    --volume ./:/wrangler \
    ich777/wrangler-dev
```

### Stop container

```
docker kill Wrangler
```

### Add secret

BOT_ADMIN = your_telegram_id

BOT_TOKEN = ...

BOT_DEBUG = true/false


### Set webhook

https://api.telegram.org/botTOKEN/setWebhook?url=https://yourdomain/webhook/botTOKEN
