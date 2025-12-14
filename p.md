Сейчас страница формирования токена доступна только через отдельно запущенный сервер src/core/auth/token-generator/server.ts
Смотри подробнее в файлах в папке src/core/auth/token-generator/

Втащи функциональность и весь комплекс эндпоинтов в HTTP сервер src/core/web/server-http.ts

Страница должна быть доступна по эндпоинту /admin

Аутентификация одним из 4-х способов
- permanentServerTokens
- basic
- jwtToken
- ntlm (смотри в src/core/auth/token-generator/ntlm)

Расширь под это дело конфигурацию:
config/custom-environment-variables.yaml
config/default.yaml
config/_local.yaml
Дополнение в src/core/_types_/config.ts уже внсено в IWebServerConfig:
```typescript
adminAuth: {
  enabled: boolean,
    type: 'permanentServerTokens' | 'basic' | 'jwtToken' | 'ntlm',
},
```

Логика такая: 
если webServer.adminAuth.enabled = true, смотрим, какой тип аутентификации задан и проверяем наличие кредов для этого типа в блоке webServer.auth 
Исключение - тип ntlm - для него ничего не требуем, его просто используем, если указан.

Добавь поля к
И раскрась иконки src/core/web/static/token-gen/user.svg
src/core/web/static/token-gen/logout.svg в основной цвет, используя для этого css. Кстати, а ты добавляешь в css основной 
цвет из настроек перед выдачей его как статика? Если нет, то надо сделать. Сделать отдельный эндпоинт 

1) Объедини два css: src/core/web/static/token-gen/styles.css и src/core/web/static/home/styles.css в один общий. Оптимизируй, если есть общие стили.
2) Сделай отдельный эндпоинт выдачи этого styles.css. С тем, чтобы подставлять в него primary color из настроек.
3) Иконки svg, в которых ранее производилась замена currentColor на уровне кода теперь должны просто подтягивать primary цвет из css.
4) иконки user.svg и logout.svg также должны принимать primary цвет
