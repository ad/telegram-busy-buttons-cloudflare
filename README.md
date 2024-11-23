# telegram-busy-buttons-cloudflare

send `/create name1 name2 nameN` to bot

bot answers with message+buttons, now you can interact with it

<img width="320" src="https://user-images.githubusercontent.com/35623/178100006-3d1de9be-4319-44f2-a239-e4f6da02689a.gif" />


### Demo

[@busybuttonsbot](https://t.me/busybuttonsbot)

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

<img width="760" alt="image" src="https://github.com/user-attachments/assets/47e6469d-13d6-4538-9e78-f462086ec665">


### Set webhook

https://api.telegram.org/botTOKEN/setWebhook?url=https://yourdomain/webhook/botTOKEN
