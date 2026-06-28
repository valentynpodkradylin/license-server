# Клиентский перехват OHFlightBuilder

Эта папка перенаправляет запросы старого плагина с
`https://plugin-license.vercel.app` на публичный license server.

## Требования

- Node.js 20 или новее;
- права администратора только для установки и удаления hosts-записи и сертификата.

## Первый запуск

1. Откройте PowerShell от имени администратора в этой папке.
2. Выполните:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-interception.ps1
```

3. Закройте административный PowerShell.
4. Откройте обычный PowerShell в этой папке и выполните:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-interception.ps1
```

5. Не закрывайте окно и запускайте плагин.

Проверка:

```powershell
Invoke-RestMethod https://plugin-license.vercel.app/health
```

Ожидаемый ответ: `status = ok`.

## Удаление

Остановите прокси через `Ctrl+C`, затем откройте PowerShell от имени
администратора и выполните:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\remove-interception.ps1
```

Если адрес сервера изменится, отредактируйте только `upstreamUrl` в
`config.json` и снова запустите `setup-interception.ps1`.
