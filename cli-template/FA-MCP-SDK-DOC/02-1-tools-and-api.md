# Tools and REST API

## Tool Development

### Tool Definition (`src/tools/tools.ts`)

```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [{
  name: 'my_custom_tool',
  description: 'Description of what this tool does',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Input query' },
      options: { type: 'object', description: 'Optional config' },
    },
    required: ['query'],
  },
}];
```

### Tool Handler (`src/tools/handle-tool-call.ts`)

```typescript
import { formatToolResult, ToolExecutionError, logger, IToolHandlerParams } from 'fa-mcp-sdk';

export const handleToolCall = async (params: IToolHandlerParams): Promise<any> => {
  const { name, arguments: args, headers, payload, transport } = params;
  // payload: { user: string, ... } if JWT auth enabled
  // transport: 'stdio' | 'sse' | 'http'
  // headers: normalized lowercase keys

  try {
    switch (name) {
      case 'my_custom_tool':
        if (!args?.query) throw new ToolExecutionError(name, 'Query required');
        return formatToolResult({ message: `Processed: ${args.query}` });
      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool ${name} failed:`, error);
    throw error;
  }
};
```

### Headers Access

Headers are normalized to lowercase. Available in HTTP/SSE transports:

```typescript
const authHeader = headers?.authorization;
const userAgent = headers?.['user-agent'];
const clientIP = headers?.['x-real-ip'] || headers?.['x-forwarded-for'];
```

### Transport-Based Credentials

`IToolHandlerParams` includes `ITransportContext` fields (`transport`, `headers`, `payload`).
See [ITransportContext](./02-2-prompts-and-resources.md#itransportcontext).

### Outbound Webhooks

The SDK does not ship a built-in webhook — it is a **handler-level pattern** enabled by
the fact that `params.headers` already carries every client header through to the tool.
Use it when the caller should be notified of each tool result (audit, dashboards, CI
chains). Reference implementation: `mcp-jira` (`src/tools/tools-manager.ts`,
`callWebHook` + dispatch block).

**Recipe:**

1. **Declare the header** so Agent Tester and `use://http-headers` advertise it:

   ```typescript
   usedHttpHeaders: [
     { name: 'x-web-hook', description: 'URL to POST the tool result to.', isOptional: true },
   ],
   ```

2. **Dispatch inside the handler** — fire-and-forget, never throw, never block the reply:

   ```typescript
   import axios from 'axios';
   import { appConfig, logger, toStr, IToolHandlerParams } from 'fa-mcp-sdk';

   const URL_REGEX = /^https?:\/\/[^\s]+$/i;

   const callWebHook = (url: string, tool: string, response: unknown, user?: string): void => {
     if (!URL_REGEX.test(url)) { return; }
     axios.post(url, { mcpName: appConfig.name, tool, user, response }, { timeout: 10_000 })
       .catch((err) => logger.warn(`Web-hook POST ${url} failed: ${toStr(err?.message || err)}`));
   };

   export const handleToolCall = async (params: IToolHandlerParams) => {
     const { name, headers = {} } = params;
     const result = await runTool(params);                // produce { text, json, hook? }
     const hookUrl = (result.hook || headers['x-web-hook'] || '').trim();
     if (hookUrl) { callWebHook(hookUrl, name, result.json, resolveUser(headers, params.payload)); }
     return formatToolResult(result.json);
   };
   ```

3. **Per-tool override (optional)** — let a tool return its own `hook` URL that wins over
   the client header. Extend your internal tool-response type:

   ```typescript
   export interface IToolResponse { text: string; json: Record<string, any>; hook?: string; }
   ```

**Body contract** (recommended; keep stable across tools):

| Field | Description |
|-------|-------------|
| `mcpName` | `appConfig.name` — which MCP sent the callback |
| `tool` | Tool name that was invoked |
| `user` | Caller identity (JWT `payload.user`, auth header, or a lookup — project-specific) |
| `response` | Full JSON the tool produced |

**Rules of thumb:** validate the URL (`http(s)://…`), short timeout (≤10 s), catch+log
only, **never** `await` the POST, and never let a webhook failure surface as a tool error.


## REST API Endpoints

Define REST endpoints in `src/api/router.ts` using [tsoa](https://tsoa-community.github.io/docs/) decorators.

### OpenAPI Generation

- **Auto-generated** on startup if `swagger/openapi.yaml` missing
- **Swagger UI**: `/docs`
- **Spec**: `/api/openapi.json`, `/api/openapi.yaml`
- Regenerate: delete `swagger/openapi.yaml` and restart

### Controller Example

```typescript
import { Router } from 'express';
import { Route, Get, Post, Body, Tags, Query } from 'tsoa';
import { logger } from 'fa-mcp-sdk';

export const apiRouter: Router = Router();

interface UserResponse { id: string; name: string; email: string; }
interface CreateUserRequest { name: string; email: string; }

@Route('api')
export class UserController {
  @Get('users/{userId}')
  @Tags('Users')
  public async getUser(userId: string): Promise<UserResponse> {
    return { id: userId, name: 'John', email: 'john@example.com' };
  }

  @Post('users')
  @Tags('Users')
  public async createUser(@Body() body: CreateUserRequest): Promise<UserResponse> {
    return { id: 'new-id', name: body.name, email: body.email };
  }

  @Get('users')
  @Tags('Users')
  public async searchUsers(@Query() query?: string, @Query() limit?: number): Promise<UserResponse[]> {
    return [];
  }
}
```

### tsoa Decorators

| Decorator | Example |
|-----------|---------|
| `@Route('prefix')` | `@Route('api')` |
| `@Get('path')` | `@Get('users/{id}')` |
| `@Post('path')` | `@Post('users')` |
| `@Put('path')` | `@Put('users/{id}')` |
| `@Delete('path')` | `@Delete('users/{id}')` |
| `@Tags('name')` | `@Tags('Users')` |
| `@Body()` | `@Body() data: Request` |
| `@Query()` | `@Query() search?: string` |
| `@Path()` | `@Path() id: string` |
| `@Header()` | `@Header('x-api-key') key: string` |
| `@Security('bearerAuth')` | Mark endpoint as requiring auth |

**Note**: Apply `@Tags()` to methods, not class.

### Manual Routes

For routes without OpenAPI docs:

```typescript
import { createAuthMW } from 'fa-mcp-sdk';

const authMW = createAuthMW();
apiRouter.get('/internal/status', authMW, (req, res) => {
  res.json({ status: 'ok' });
});
```

## OpenAPI Types

```typescript
import { configureOpenAPI, OpenAPISpecResponse, SwaggerUIConfig } from 'fa-mcp-sdk';

interface OpenAPISpecResponse {
  openapi: string;                  // '3.0.0'
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description: string }>;
  paths: Record<string, any>;
  components?: { schemas?: Record<string, any>; securitySchemes?: Record<string, any> };
  tags?: Array<{ name: string; description: string }>;
}

interface SwaggerUIConfig {
  customCss?: string;
  customSiteTitle?: string;
  customfavIcon?: string;
  swaggerOptions?: {
    persistAuthorization?: boolean;
    displayRequestDuration?: boolean;
    docExpansion?: 'none' | 'list' | 'full';
    defaultModelsExpandDepth?: number;
  };
}
```

### Swagger Config

```yaml
# config/default.yaml
swagger:
  servers:
    - url: 'https://api.example.com'
      description: 'Production'

webServer:
  auth:
    enabled: true  # Adds Bearer auth to spec
```


### Example: Complete API Setup

```typescript
// src/api/router.ts
import { Router } from 'express';
import { Route, Get, Post, Body, Tags, Security } from 'tsoa';

export const apiRouter: Router = Router();

interface DataResponse {
  id: string;
  value: string;
}

@Route('api')
export class DataController {
  /**
   * Get data by ID
   * @param id Unique identifier
   */
  @Get('data/{id}')
  @Tags('Data')
  @Security('bearerAuth')
  public async getData(id: string): Promise<DataResponse> {
    return { id, value: 'example' };
  }

  /**
   * Create new data entry
   */
  @Post('data')
  @Tags('Data')
  @Security('bearerAuth')
  public async createData(
    @Body() body: { value: string }
  ): Promise<DataResponse> {
    return { id: 'new-id', value: body.value };
  }
}
```

After starting the server with this controller:
- Swagger UI available at `/docs`
- Endpoints documented with authentication requirements
- Request/response schemas generated from TypeScript types
