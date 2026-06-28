# Лицензионный сервер OHFlightBuilder

Fastify-сервер для лицензий, обновлений, загрузок и прогноза погоды плагина
OHFlightBuilder. Те же API работают локально и на Vercel.

## Установка

```powershell
pnpm install
pnpm build
```

Локально сервер слушает `127.0.0.1:8080`. Настройки лежат в `.env`.

## Переменные окружения

```env
HOST=127.0.0.1
PORT=8080
DATABASE_PATH=./data/licenses.sqlite
DATABASE_URL=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
PUBLIC_SITE_URL=https://your-project.vercel.app
OPEN_METEO_URL=https://api.open-meteo.com/v1/forecast
LOG_LEVEL=info
```

Если `DATABASE_URL` пустой, используется локальный SQLite-файл. Для Vercel
укажите Neon connection string в `DATABASE_URL`.

## Админка

Админка встроена в тот же Fastify app:

```text
https://your-project.vercel.app/admin
```

Логин и пароль берутся из `ADMIN_USERNAME` и `ADMIN_PASSWORD`. Через админку
можно создать бессрочную лицензию, создать лицензию с ручным `expires_at`,
заблокировать и восстановить ключ.

## Vercel + Neon

1. Создайте Neon Postgres database.
2. В Vercel добавьте env:
   `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `PUBLIC_SITE_URL`.
3. Оставьте Framework Preset `Other`, Build Command `pnpm build`, Output Directory `dist`.
4. Выключите `Vercel Authentication` в `Settings -> Deployment Protection`,
   иначе API будет доступен только после входа в Vercel.
5. Задеплойте репозиторий. `vercel.json` направляет все запросы в тот же
   Fastify handler.

Публичные маршруты остаются прежними:

```text
/api/license/activate
/api/license/status
/api/license/update
/api/forecast
/downloads/:filename
```

## Локальный перехват старой DLL

Старая DLL обращается к `PUBLIC_SITE_URL`. Для локального режима можно
направить этот домен на `127.0.0.1` и оставить HTTPS:

```powershell
$env:PUBLIC_SITE_URL="https://plugin-license.vercel.app"
.\setup-interception.ps1
pnpm start:intercept
```

Скрипт нужно запускать от имени администратора. Он добавляет hosts-запись,
создает локальный TLS-сертификат и проксирует HTTPS `:443` в Fastify на
`127.0.0.1:8080`.

## CLI

```powershell
pnpm license:create -- --key TEST-LICENSE-001
pnpm license:create -- --key TEST-LICENSE-002 --expires 2027-01-01T00:00:00Z
pnpm license:list
pnpm license:revoke -- --key TEST-LICENSE-001
pnpm license:restore -- --key TEST-LICENSE-001
pnpm update:set -- --version 1.13.0 --notes "Описание" --link "$env:PUBLIC_SITE_URL/downloads/OHFlightBuilder.zip"
```

CLI тоже использует `DATABASE_URL`, если он задан.

## Проверка

```powershell
pnpm type-check
pnpm test
pnpm build
```
