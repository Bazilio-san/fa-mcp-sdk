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

### Outbound Webhooks (`x-web-hook`)

Handler-level pattern. The SDK does **not** ship a built-in webhook dispatcher — it exposes
everything you need (`params.headers`, `appConfig`, `logger`) and leaves the policy to the project.
This section is the **canonical recipe**: implement it as written so every fa-mcp-sdk-based MCP
server behaves the same way for clients and downstream collectors.

**What it is:** after every tool invocation the server can `POST` the tool result to an external
URL. Useful for audit trails, real-time dashboards, chaining MCP calls into CI/automation pipelines.
Opt-in per request (via header) and optionally per tool (via the response object). A failing webhook
**must never** fail the tool call.

#### Contract (stable across all MCPs)

**Inbound — precedence:**

| Source              | Form                                                    | Precedence |
|---------------------|---------------------------------------------------------|------------|
| Per-tool override   | `IToolResponse.hook: string` returned by the handler    | wins       |
| Per-request header  | `x-web-hook: <http(s) URL>`                             | fallback   |

If neither is present, no webhook fires.

**Outbound request:**

- Method: `POST`, `Content-Type: application/json`, timeout ≤ 10 000 ms
- Body:

```json
{
  "mcpName": "<appConfig.name>",
  "tool": "<tool_name>",
  "user": "<caller-id-or-omitted>",
  "response": { "...": "tool's full JSON result" }
}
```

| Field      | Description                                                                  |
|------------|------------------------------------------------------------------------------|
| `mcpName`  | `appConfig.name` — identifies which MCP sent the callback                    |
| `tool`     | Name of the invoked tool                                                     |
| `user`     | Best-effort caller identity (see *User resolution*); **omit** if unresolved  |
| `response` | Full JSON returned by the tool handler (same payload sent to the client)     |

Do **not** add ad-hoc fields on a per-project basis without versioning the body — downstream
collectors rely on this exact shape.

#### Implementation recipe

**1. Declare the header** so `use://http-headers`, Agent Tester, and tool-call introspection
advertise it:

```typescript
// src/start.ts
usedHttpHeaders.push({
  name: 'x-web-hook',
  description:
    'Optional URL called via POST after each tool invocation. '
    + 'Body: { mcpName, tool, user, response }. Fire-and-forget; failures are logged only.',
  isOptional: true,
});
```

**2. Add `hook?` to the internal tool-response type** (lets a handler override the URL per tool):

```typescript
// src/_types_/tool.ts
export interface IToolResponse {
  text: string;
  json: Record<string, any>;
  hook?: string; // per-tool URL override; takes precedence over x-web-hook header
}
```

**3. Dispatcher — fire-and-forget, never throws:**

```typescript
// src/tools/tools-manager.ts
import axios from 'axios';
import { appConfig, logger as lgr, toStr } from 'fa-mcp-sdk';

const logger = lgr.getSubLogger({ name: 'tools' });
const URL_REGEX = /^https?:\/\/[^\s]+$/i;

const callWebHook = (
  url: string,
  toolName: string,
  json: Record<string, any>,
  user?: string,
): void => {
  if (!URL_REGEX.test(url)) { return; }                 // silently drop garbage URLs
  const body = { mcpName: appConfig.name, tool: toolName, response: json, user };
  axios.post(url, body, { timeout: 10_000 })
    .catch((err) => logger.warn(`Web-hook POST ${url} failed: ${toStr(err?.message || err)}`));
};
```

Rules:

- **No `await`.** The webhook must not delay the MCP response.
- **No re-throws.** A 5xx, timeout, or DNS failure is a `warn` log, nothing more.
- **URL allow-list.** At minimum, require `http(s)://`. Add an internal-net allow-list via config
  (e.g. `webhook.allowedHosts`) if the threat model requires it (see *Security*).

**4. Wire it into the tool-call entry point** — dispatch after the handler resolves and before
the result is returned:

```typescript
export const handleToolCall = async (params: IToolHandlerParams): Promise<any> => {
  const { name: toolName, arguments: args, headers: mcpRequestHeaders = {} } = params;

  const tool = (await getTools(mcpRequestHeaders)).get(toolName);
  if (!tool?.handler) { throw new ToolExecutionError(toolName, `Unknown tool: ${toolName}`); }

  const ctx: ToolContext = {
    httpClient: createHttpClient(mcpRequestHeaders),
    logger: logger.getSubLogger({ name: toolName }),
    mcpRequestHeaders,
  };

  const toolResponse: IToolResponse = await tool.handler(args, ctx);

  // ─── webhook dispatch (fire-and-forget) ─────────────────────────────────────
  const hookUrl = (toolResponse?.hook || mcpRequestHeaders['x-web-hook'] || '').trim();
  if (hookUrl) {
    const syncUser = resolveActualUser(mcpRequestHeaders);     // see step 5
    if (syncUser) {
      callWebHook(hookUrl, toolName, toolResponse.json, syncUser);
    } else {
      // Async user resolution — still fire-and-forget; do not block the tool response.
      getCachedSelfUser(ctx.httpClient, mcpRequestHeaders)
        .then((u) => callWebHook(hookUrl, toolName, toolResponse.json, u));
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  return formatToolResult(toolResponse);
};
```

**5. User resolution — best-effort, two-step.** The `user` field is what makes the webhook useful
for audit. Resolve carefully, but never let resolution fail the call.

- **Step A — Sync (preferred):** derive from headers / JWT payload / config without I/O
  (e.g. JWT `payload.user`, a custom `x-actual-user` header your auth layer stamps, etc.).
- **Step B — Async fallback (only when sync returns nothing):** call the upstream "who am I"
  endpoint with the same auth, **cache the result** (recommended TTL: 1 h, key by hashed
  `Authorization`), and dedupe in-flight requests (thundering-herd protection).
- If both steps fail → **omit** the `user` field. Never invent a placeholder like `"unknown"`.

```typescript
export function resolveActualUser (headers: Record<string, string>): string | undefined { /* … */ }

export const getCachedSelfUser = async (
  httpClient: AxiosInstance,
  headers: Record<string, string>,
): Promise<string | undefined> => { /* GET /me, cache by hashed Authorization, dedupe */ };
```

#### Per-tool override — when to use

A handler may force a specific webhook URL:

```typescript
return { text, json, hook: 'https://collector.internal/special' };
```

Use sparingly. Legitimate cases:

- a long-running tool whose result feeds a fixed pipeline regardless of the client;
- a tool that should **never** webhook (e.g. read of a secret) — return `hook: ''` only if the
  dispatcher treats empty string as "skip even if header is set". With the snippet above this works
  naturally because `(toolResponse?.hook || header)` short-circuits on any truthy `hook`; to force
  skip, have the handler strip the header from `ctx` or short-circuit `hookUrl` explicitly.

If neither applies, do not set `hook` — let the client decide.

#### Security

- **URL validation** — reject anything that does not match `http(s)://…`. For public-facing MCPs,
  restrict to a configured allow-list (`webhook.allowedHosts` in `config/default.yaml`).
- **SSRF surface** — the webhook is a server-side `POST` to a client-supplied URL. Acceptable for
  trusted MCP clients; not acceptable open on the internet without an allow-list.
- **No secrets in the body** — `response` is the same JSON the client already received. Do **not**
  add credentials, raw tokens, or PII not present in the response.
- **No retries** — duplicate POSTs to a flaky collector are worse than a missed event. If the
  collector needs guarantees, let it poll.
- **Logging** — log `tool`, target host, and outcome at `warn`/`debug`; **never** log the full body
  at `info` level (audit log noise + potential PII).

#### Testing checklist

- [ ] Header declared in `usedHttpHeaders` and visible at `/use://http-headers`.
- [ ] Tool call **without** `x-web-hook` → no outbound POST.
- [ ] Tool call **with** valid `x-web-hook` → exactly one POST, body matches the contract above.
- [ ] Collector returns 500 → tool response still succeeds; one `warn` line in the log.
- [ ] Collector hangs → tool response returns within normal latency; POST aborts at 10 s.
- [ ] Malformed URL (`javascript:…`, missing scheme) → no POST, no error to client.
- [ ] Per-tool `hook` set → wins over the header.
- [ ] Sync user resolution hits → `user` populated immediately, no extra HTTP call.
- [ ] Sync empty, async succeeds → POST fires after `/me` resolves; tool response was not delayed.
- [ ] Both user paths fail → POST fires with `user` **field omitted** (not `null`, not `"unknown"`).


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
