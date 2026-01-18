# План: Добавление transport/headers/payload в prompts/list

## Цель

Сделать `customPrompts` аналогично `tools`:
- Может быть массивом `IPromptData[]` или async функцией `(args) => Promise<IPromptData[]>`
- Функция получает `{ transport, headers, payload }`

## Изменения по файлам

### 1. `src/core/_types_/types.ts`

- Добавить тип `IGetPromptsArgs` (аналог `IGetToolsArgs`):
  ```typescript
  export interface IGetPromptsArgs {
    transport: TransportType;
    headers?: Record<string, string>;
    payload?: { user: string; [key: string]: any };
  }
  ```

- Изменить тип `customPrompts` в `McpServerData`:
  ```typescript
  customPrompts?: IPromptData[] | ((args: IGetPromptsArgs) => Promise<IPromptData[]>);
  ```

### 2. `src/core/index.ts`

- Добавить экспорт `IGetPromptsArgs`

### 3. `src/core/mcp/prompts.ts`

- Сделать `getPromptsList` асинхронной функцией с параметром `args: IGetPromptsArgs`
- В `createPrompts` проверять тип `customPrompts`:
  - Если функция — вызвать с args
  - Если массив — использовать напрямую
- Убрать кеширование `_prompts` (теперь результат зависит от args)
- `getPrompt` тоже должен принимать args для получения актуального списка промптов

### 4. `src/core/web/server-http.ts`

- `prompts/list`: вызывать `await getPromptsList({ transport: 'http', headers, payload })`
- SSE: переопределить `ListPromptsRequestSchema` в `createSseServer` (как сделано для tools)

### 5. `src/core/mcp/create-mcp-server.ts`

- `ListPromptsRequestSchema`: вызывать `await getPromptsList({ transport: 'stdio' })`

### 6. `src/core/web/home-api.ts`

- Вызывать `await getPromptsList({ transport: 'http' })`

### 7. `src/core/auth/middleware.ts`

- `isPublicPrompt`: вызывать `await getPromptsList(...)` — функция станет async
- Это повлияет на `isPublicMcpRequest` — тоже станет async

### 8. `cli-template/FA-MCP-SDK-DOC/02-2-prompts-and-resources.md`

- Документировать возможность использования функции для `customPrompts`
