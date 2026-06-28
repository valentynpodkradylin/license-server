# Деплой, проверка и локальный перехват

Этот гайд для человека, который будет пользоваться сайтом админки и при
необходимости запускать локальный перехват трафика старого плагина.

## Что понадобится

- аккаунт Vercel;
- база Neon Postgres;
- репозиторий с этим проектом;
- PowerShell от имени администратора только для локального перехвата.

## 1. Подготовить Neon

1. Создайте Neon project и database.
2. Скопируйте connection string вида:

```text
postgresql://USER:PASSWORD@HOST.neon.tech/DB?sslmode=require
```
Это значение понадобится как `DATABASE_URL`.

## 2. Задеплоить на Vercel

1. В Vercel создайте новый project из GitHub-репозитория.
2. Framework preset оставьте `Other`, если Vercel не определил проект сам.
3. Добавьте Environment Variables:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DB?sslmode=require
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
PUBLIC_SITE_URL=https://license-server-valentynpodkradylins-projects.vercel.app
OPEN_METEO_URL=https://api.open-meteo.com/v1/forecast
LOG_LEVEL=info
```

4. Build Command укажите `pnpm build`, Output Directory — `dist`.
5. Нажмите Deploy.
6. В `Settings -> Deployment Protection` выключите `Vercel Authentication`,
   иначе внешние запросы плагина будут перенаправлены на вход Vercel.
7. После деплоя откройте production URL:

```text
https://license-server-valentynpodkradylins-projects.vercel.app
```

`PUBLIC_SITE_URL` должен совпадать с публичным production URL.

## 3. Проверить сайт и API

Проверка health endpoint:

```powershell
$SiteUrl = "https://license-server-valentynpodkradylins-projects.vercel.app"
Invoke-RestMethod "$SiteUrl/health"
```

Ожидаемый ответ:

```json
{
  "status": "ok"
}
```

Проверка админки:

1. Откройте:

```text
https://license-server-valentynpodkradylins-projects.vercel.app/admin
```

2. Войдите через `ADMIN_USERNAME` и `ADMIN_PASSWORD`.
3. Создайте тестовую лицензию, например:

```text
TEST-LICENSE-001
```

Если срок действия оставить пустым, лицензия будет бессрочной.

## 4. Проверить активацию лицензии через PowerShell

Сгенерируйте тестовый `deviceId` и вызовите activation endpoint:

```powershell
$SiteUrl = "https://license-server-valentynpodkradylins-projects.vercel.app"
$Body = @{
  key = "TEST-LICENSE-001"
  deviceId = ("a" * 64)
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$SiteUrl/api/license/activate" `
  -ContentType "application/json" `
  -Body $Body
```

Успешный ответ будет текстовой строкой лицензии. Если ключ не найден, будет
`404`. Если ключ заблокирован или истек, будет `403`.

## 5. Локальный перехват трафика плагина

Перехват нужен только если старая DLL уже ходит на фиксированный домен, а вы
хотите направить этот домен на локальный сервер.

Откройте PowerShell от имени администратора:

```powershell
cd D:\STAFF\license-server
$env:PUBLIC_SITE_URL = "https://plugin-license.vercel.app"
.\setup-interception.ps1
```

Скрипт:

- добавит домен из `PUBLIC_SITE_URL` в hosts;
- направит домен на `127.0.0.1`;
- создаст локальный TLS-сертификат;
- подготовит прокси `https://DOMAIN:443 -> http://127.0.0.1:8080`.

После этого в обычном PowerShell запустите локальный сервер:

```powershell
cd D:\STAFF\license-server
pnpm build
pnpm start:intercept
```

Проверка локального перехвата:

```powershell
Invoke-RestMethod https://plugin-license.vercel.app/health
```

Ожидаемый ответ:

```json
{
  "status": "ok"
}
```

## 6. Перехват для другого домена

Если плагин должен обращаться к вашему Vercel-домену, укажите его перед
настройкой:

```powershell
cd D:\STAFF\license-server
$env:PUBLIC_SITE_URL = "https://your-project.vercel.app"
.\setup-interception.ps1
pnpm build
pnpm start:intercept
```

Проверка:

```powershell
Invoke-RestMethod https://your-project.vercel.app/health
```

Важно: пока включен hosts-перехват, этот домен на текущем компьютере будет
вести на локальный сервер, а не на реальный Vercel.

## 7. Удалить локальный перехват

Откройте PowerShell от имени администратора:

```powershell
cd D:\STAFF\license-server
.\remove-interception.ps1
```

После удаления домен снова будет открываться через интернет.

## Частые проверки

Проверить список лицензий локально:

```powershell
pnpm license:list
```

Создать лицензию локально:

```powershell
pnpm license:create -- --key TEST-LICENSE-001
```

Создать лицензию со сроком:

```powershell
pnpm license:create -- --key TEST-LICENSE-002 --expires 2027-01-01T00:00:00Z
```

Заблокировать лицензию:

```powershell
pnpm license:revoke -- --key TEST-LICENSE-001
```

Восстановить лицензию:

```powershell
pnpm license:restore -- --key TEST-LICENSE-001
```

## Если что-то не работает

- `401` в админке: неверные `ADMIN_USERNAME` или `ADMIN_PASSWORD`.
- `404` при активации: лицензия не создана в той базе, куда смотрит сервер.
- `403` при активации: лицензия заблокирована или истек срок.
- `EADDRINUSE 127.0.0.1:8080`: локальный сервер уже запущен, закройте старый
  процесс через `Ctrl+C`.
- Браузер открывает локальный сервер вместо Vercel: удалите перехват через
  `.\remove-interception.ps1`.
