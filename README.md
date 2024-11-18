# telegram-busy-buttons-cloudflare

## local run via wrangler

```
docker run --name Wrangler --rm \
    -p 8080:8080 \
    --env 'START_WRANGLER=true' \
    --env 'WRANGLER_START_CMD=wrangler pages dev ./ --port 8080 --ip 0.0.0.0' \
    --env 'UID=99' \
    --env 'GID=100' \
    --env 'UMASK=0000' \
    --env 'DATA_PERMS=770' \
    --volume /Users/ad/Developer/github.com/ad/telegram-busy-buttons-cloudflare/:/wrangler \
    --platform linux/amd64 \
    ich777/wrangler-dev
```

### stop container

```
docker kill Wrangler
```
