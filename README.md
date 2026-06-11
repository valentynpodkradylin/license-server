# Локальный сервер лицензий OHFlightBuilder

Сервер обрабатывает запросы лицензирования, обновлений и прогноза погоды
плагина OHFlightBuilder.

## Установка

```powershell
cd D:\Downloads\TEST\license-server
pnpm install
pnpm build
```

По умолчанию HTTP-сервер слушает `127.0.0.1:8080`. Значения `HOST` и `PORT`
можно изменить в файле `.env`.

## Первый запуск: настройка перехвата

Старая DLL обращается к `https://plugin-license.vercel.app`. Чтобы направить
эти запросы на локальный сервер без изменения DLL:

1. Откройте PowerShell **от имени администратора**.
2. Выполните:

```powershell
cd D:\Downloads\TEST\license-server
.\setup-interception.ps1
```

Скрипт:

- добавляет `plugin-license.vercel.app` в системный файл `hosts`;
- направляет домен на `127.0.0.1`;
- создаёт и устанавливает доверенный локальный TLS-сертификат.

Эту настройку нужно выполнить только один раз.

## Обычный запуск

В первом окне PowerShell запустите сервер:

```powershell
cd D:\Downloads\TEST\license-server
pnpm start:intercept
```

Не закрывайте это окно во время работы Mission Planner.

В другом окне PowerShell создайте лицензионный ключ:

```powershell
cd D:\Downloads\TEST\license-server
pnpm license:create -- --key TEST-LICENSE-001
```

Затем запустите:

```powershell
D:\Downloads\MissionPlanner-1.3.82\MissionPlanner.exe
```

Когда OHFlightBuilder запросит ключ активации, введите:

```text
TEST-LICENSE-001
```

## Как работает перехват

HTTPS-прокси слушает `127.0.0.1:443` и передаёт запросы локальному серверу на
`http://127.0.0.1:8080`, сохраняя HTTP-метод, путь, заголовки и тело запроса.

Например:

```text
https://plugin-license.vercel.app/api/license/activate
```

перенаправляется на:

```text
http://127.0.0.1:8080/api/license/activate
```

Аналогично работают:

- `/api/license/status`;
- `/api/license/update`;
- `/api/forecast`.

Маршрут `/health` используется только для проверки состояния сервера и не
заменяет маршруты `/api/...`.

Проверка:

```powershell
Invoke-RestMethod https://plugin-license.vercel.app/health
```

Ожидаемый ответ:

```json
{
  "status": "ok"
}
```

## Управление лицензиями

Создать ключ:

```powershell
pnpm license:create -- --key TEST-LICENSE-001
```

Создать ключ со сроком действия:

```powershell
pnpm license:create -- --key TEST-LICENSE-002 --expires 2027-01-01T00:00:00Z
```

Показать лицензии:

```powershell
pnpm license:list
```

Заблокировать лицензию:

```powershell
pnpm license:revoke -- --key TEST-LICENSE-001
```

Восстановить лицензию:

```powershell
pnpm license:restore -- --key TEST-LICENSE-001
```

## Обновления плагина

Архив обновления необходимо поместить в каталог `downloads`, затем выполнить:

```powershell
pnpm update:set -- --version 1.13.0 --notes "Описание изменений" --link "http://localhost:8080/downloads/OHFlightBuilder.zip"
```

## Остановка

Для остановки сервера нажмите `Ctrl+C` в окне с `pnpm start:intercept`.

## Удаление перехвата

Откройте PowerShell от имени администратора и выполните:

```powershell
cd D:\Downloads\TEST\license-server
.\remove-interception.ps1
```

Скрипт удалит запись из `hosts`, локальный сертификат и созданные файлы
сертификата.

## Ошибка EADDRINUSE

Ошибка:

```text
listen EADDRINUSE: address already in use 127.0.0.1:8080
```

означает, что сервер уже запущен в другом окне или другим процессом. Закройте
предыдущий экземпляр с помощью `Ctrl+C`, после чего повторите:

```powershell
pnpm start:intercept
```
