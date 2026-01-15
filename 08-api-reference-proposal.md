# Предложение по расширению документации FA-MCP-SDK

## Анализ недокументированных экспортов

После сравнения экспортов из `src/core/index.ts` с содержимым документации в `cli-template/FA-MCP-SDK-DOC/` выявлены следующие публичные API, которые экспортируются, но не описаны в документации.

---

## Список недокументированных экспортов

### 1. Конфигурация и инициализация

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `AppConfig` | type | Базовый тип конфигурации приложения, расширяемый в проектах |
| `getProjectData` | function | Получение метаданных проекта (name, version, description) из package.json |
| `getSafeAppConfig` | function | Получение конфигурации без чувствительных данных (пароли, токены) для логирования |

### 2. Типы Active Directory

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `IADConfig` | type | Интерфейс конфигурации Active Directory (домены, контроллеры) |
| `IDcConfig` | type | Интерфейс конфигурации доменного контроллера (host, credentials, baseDn) |

### 3. Типы MCP-протокола

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `IGetPromptParams` | type | Параметры запроса промпта |
| `IResource` | type | Базовый интерфейс ресурса MCP |
| `IReadResourceRequest` | type | Запрос на чтение ресурса |
| `IEndpointsOn404` | type | Конфигурация обработки 404 для HTTP эндпоинтов |
| `IToolProperties` | type | Свойства инструмента в схеме inputSchema |

### 4. Аутентификация

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `TTokenType` | type | Тип токена аутентификации ('jwtToken' \| 'basic' \| 'permanentServerTokens' \| 'ntlm') |
| `generateTokenApp` | async function | Генерация JWT-токена с запуском UI приложения Token Generator |

### 5. Ошибки

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `ServerError` | class | Класс серверной ошибки для внутренних сбоев MCP-сервера |

### 6. Утилиты

| Экспорт | Тип       | Краткое описание                                                     |
|---------|-----------|----------------------------------------------------------------------|
| `normalizeHeaders` | function  | Нормализация HTTP-заголовков (lowercase ключи, объединение массивов) |
| `gettTools` | function  | Получение списка инструментов                     |

### 7. Константы

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `ROOT_PROJECT_DIR` | const | Абсолютный путь к корневой директории проекта |

### 8. Тестирование

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `McpStreamableHttpClient` | class | Тестовый клиент для Streamable HTTP транспорта (новый стандарт MCP 2025) |

### 9. OpenAPI/Swagger

| Экспорт | Тип | Краткое описание |
|---------|-----|------------------|
| `configureOpenAPI` | function | Программная конфигурация OpenAPI/Swagger (серверы, теги, описание) |
| `createSwaggerUIAssetsMiddleware` | function | Middleware для раздачи статики Swagger UI |
| `OpenAPISpecResponse` | type | Тип ответа с OpenAPI-спецификацией |
| `SwaggerUIConfig` | type | Конфигурация Swagger UI (docExpansion, filter, persistAuthorization) |

---

## Предложение по структуре документации

### Вариант A: Расширение существующих файлов

1. **01-getting-started.md** — добавить:
   - `AppConfig`, `getProjectData`, `getSafeAppConfig`

2. **04-authentication.md** — добавить:
   - `TTokenType`, `generateTokenApp`

3. **05-ad-authorization.md** — добавить:
   - `IADConfig`, `IDcConfig`

4. **06-utilities.md** — добавить:
   - `ServerError`, `normalizeHeaders`, `gettTools`, `ROOT_PROJECT_DIR`

5. **07-testing-and-operations.md** — добавить:
   - `McpStreamableHttpClient`

6. **02-1-tools-and-api.md** — добавить раздел OpenAPI/Swagger:
   - `configureOpenAPI`, `createSwaggerUIAssetsMiddleware`, `OpenAPISpecResponse`, `SwaggerUIConfig`

### Вариант B: Создание нового файла справочника API (рекомендуется)

Создать файл **08-api-reference.md** с полным справочником всех экспортируемых API:

```
08-api-reference.md
├── Configuration Exports
│   ├── AppConfig (type)
│   ├── getProjectData()
│   └── getSafeAppConfig()
├── Active Directory Types
│   ├── IADConfig
│   └── IDcConfig
├── MCP Protocol Types
│   ├── IGetPromptParams
│   ├── IResource
│   ├── IReadResourceRequest
│   ├── IEndpointsOn404
│   └── IToolProperties
├── Authentication
│   ├── TTokenType
│   └── generateTokenApp()
├── Error Classes
│   └── ServerError
├── Utilities
│   ├── normalizeHeaders()
│   ├── getTools()
│   └── ROOT_PROJECT_DIR
├── Test Clients
│   └── McpStreamableHttpClient
└── OpenAPI/Swagger
    ├── configureOpenAPI()
    ├── createSwaggerUIAssetsMiddleware()
    ├── OpenAPISpecResponse
    └── SwaggerUIConfig
```

---

## Краткие описания для документирования

### Configuration

```typescript
/**
 * AppConfig - Base configuration type for MCP server applications.
 * Extend this interface in your project's custom-config.ts to add custom settings.
 */
export type AppConfig = { /* ... */ };

/**
 * getProjectData - Retrieves project metadata from package.json.
 * @returns { name, version, description, keywords } from package.json
 */
export function getProjectData(): ProjectData;

/**
 * getSafeAppConfig - Returns configuration with sensitive data masked.
 * Useful for logging configuration without exposing secrets.
 * Replaces passwords, tokens, and keys with '***'.
 */
export function getSafeAppConfig(): AppConfig;
```

### Active Directory

```typescript
/**
 * IADConfig - Active Directory configuration for group checking.
 * Contains domain definitions with controllers and credentials.
 */
export interface IADConfig { domains: Record<string, IDcConfig> };

/**
 * IDcConfig - Domain Controller configuration.
 * @property controllers - Array of LDAP URLs (e.g., 'ldap://dc1.corp.com')
 * @property username - Service account for AD queries
 * @property password - Service account password
 * @property baseDn - Optional base DN (auto-derived from controller if not set)
 * @property default - Mark as default domain
 */
export interface IDcConfig { /* ... */ };
```

### Authentication

```typescript
/**
 * TTokenType - Authentication token type identifier.
 * Used to specify which auth method was used for a request.
 */
export type TTokenType = 'jwtToken' | 'basic' | 'permanentServerTokens' | 'ntlm';

/**
 * generateTokenApp - Launches Token Generator application.
 * Dynamically imports and starts the token generation UI server.
 * Used for administrative token generation tasks.
 */
export async function generateTokenApp(...args: any[]): Promise<any>;
```

### Errors

```typescript
/**
 * ServerError - Internal server error for MCP operations.
 * Use for unexpected server-side failures that aren't tool-specific.
 * @param message - Error message
 * @param code - Optional error code (default: 'SERVER_ERROR')
 */
export class ServerError extends BaseMcpError { /* ... */ };
```

### Utilities

```typescript
/**
 * normalizeHeaders - Normalize HTTP headers for consistent access.
 * - Converts all header names to lowercase
 * - Joins array values with ', '
 * - Filters non-string values
 * @param headers - Raw headers object
 * @returns Normalized headers with lowercase keys
 */
export function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string>;

/**
 * resetTools - Clear registered tools from memory.
 * Primarily used in testing to reset state between tests.
 */
export function resetTools(): void;

/**
 * ROOT_PROJECT_DIR - Absolute path to the project root directory.
 * Calculated at runtime based on the entry point location.
 */
export const ROOT_PROJECT_DIR: string;
```

### Testing

```typescript
/**
 * McpStreamableHttpClient - Test client for MCP Streamable HTTP transport.
 * Implements the new MCP 2025 streamable HTTP specification.
 * Use for testing servers that support streaming responses.
 */
export class McpStreamableHttpClient {
  constructor(baseUrl: string);
  callTool(name: string, args?: any, headers?: object): Promise<any>;
  getPrompt(name: string, args?: object): Promise<any>;
  listResources(): Promise<any>;
  readResource(uri: string): Promise<any>;
}
```

### OpenAPI/Swagger

```typescript
/**
 * configureOpenAPI - Programmatically configure OpenAPI specification.
 * Call before initMcpServer() to customize Swagger documentation.
 * @param config - OpenAPI configuration options
 */
export function configureOpenAPI(config: {
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  info?: { title?: string; description?: string; version?: string };
}): void;

/**
 * createSwaggerUIAssetsMiddleware - Express middleware for Swagger UI assets.
 * Serves swagger-ui-dist static files for the /docs endpoint.
 * @returns Express middleware function
 */
export function createSwaggerUIAssetsMiddleware(): RequestHandler;

/**
 * OpenAPISpecResponse - Response type for OpenAPI specification endpoint.
 * Contains the full OpenAPI 3.0 specification object.
 */
export type OpenAPISpecResponse = { /* OpenAPI 3.0 spec */ };

/**
 * SwaggerUIConfig - Configuration options for Swagger UI rendering.
 * @property docExpansion - 'list' | 'full' | 'none'
 * @property filter - Enable search filter
 * @property persistAuthorization - Remember auth between reloads
 */
export type SwaggerUIConfig = { /* ... */ };
```

---

## Рекомендация

**Рекомендуется Вариант B** — создание отдельного файла `08-api-reference.md` как полного справочника API. Это позволит:

1. Сохранить существующую документацию сфокусированной на use-cases
2. Предоставить полный справочник для опытных разработчиков
3. Упростить поддержку при добавлении новых экспортов
4. Обеспечить единую точку входа для поиска любого API

После создания справочника, добавить ссылку на него в `00-FA-MCP-SDK-index.md`:

```markdown
| [08-api-reference.md](08-api-reference.md) | Complete API reference for all exports | Looking up specific function signatures, types |
```

---

*Документ создан: 2026-01-14*
*Источник анализа: src/core/index.ts vs cli-template/FA-MCP-SDK-DOC/*
