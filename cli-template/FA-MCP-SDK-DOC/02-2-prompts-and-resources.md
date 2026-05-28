# Prompts and Resources

## Prompts

### Standard Prompts

#### Agent Brief (`src/prompts/agent-brief.ts`)

**Level 1**: Short description for agent selection. LLM doesn't see tools at this level.

```typescript
export const AGENT_BRIEF = 'Database management agent for PostgreSQL operations';
```

#### Agent Prompt (`src/prompts/agent-prompt.ts`)

**Level 2**: Full instructions shown after agent selection. LLM sees tools list.

```typescript
export const AGENT_PROMPT = `You are a database management assistant.
- Check table existence before operations
- Use transactions for multi-step operations
- Return results in JSON format`;
```

### Custom Prompts

Add in `src/prompts/custom-prompts.ts`:

```typescript
import { IPromptData, IGetPromptRequest, IPromptArgument } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  { name: 'greeting', description: 'Greeting message', arguments: [],
    content: 'Hello! How can I help?' },

  // Standard §10.5 — parameterised prompt. The `arguments[]` array is advertised in
  // prompts/list; the values arrive as `request.params.arguments` (string map) on
  // prompts/get. The content function receives them as the second argument.
  {
    name: 'context_prompt',
    description: 'Context-aware prompt with explicit arguments',
    arguments: [
      { name: 'topic',    description: 'Subject area to focus on', required: true },
      { name: 'audience', description: 'Audience level (junior / senior)',     required: false },
    ] satisfies IPromptArgument[],
    content: (_req, args) =>
      `Focus on ${args?.topic ?? 'the codebase'} for a ${args?.audience ?? 'mixed'} audience.`,
  },

  { name: 'admin_only', description: 'Admin instructions', arguments: [],
    content: 'Admin-only content', requireAuth: true },
];
```

> **Compatibility.** The old single-argument signature
> `(req: IGetPromptRequest) => string` still works — the second `args` parameter is
> optional. Only update prompts that need access to the values.

Pass to server:
```typescript
const serverData: McpServerData = { ..., customPrompts };
```

### ITransportContext

Universal type for dynamic tools/prompts/resources functions:

```typescript
interface ITransportContext {
  transport: 'stdio' | 'sse' | 'http';
  headers?: Record<string, string>;            // HTTP headers (HTTP/SSE only)
  payload?: { user: string; [key: string]: any };  // Auth payload (if authenticated HTTP/SSE only)
  clientCapabilities?: IClientCapabilities;    // From MCP `initialize` handshake (see 10-mcp-apps.md)
}
```

Use for transport-based credential routing:
```typescript
function getApiKey(ctx: ITransportContext): string {
  if (ctx.transport === 'stdio') return process.env.API_KEY || '';
  return ctx.headers?.['x-api-key'] || '';
}
```

Use `clientCapabilities` to branch UI-augmented vs. text-only output (see
[10-mcp-apps.md → "Reading client capabilities from fa-mcp-sdk"](./10-mcp-apps.md)).

### Dynamic Prompts (Function)

For dynamic prompt lists based on transport type, headers, or user:

```typescript
import { IPromptData, ITransportContext } from 'fa-mcp-sdk';

export const customPrompts = async (ctx: ITransportContext): Promise<IPromptData[]> => {
  const { transport, headers, payload } = ctx;

  const prompts: IPromptData[] = [
    { name: 'greeting', description: 'Greeting message', arguments: [],
      content: 'Hello! How can I help?' },
  ];

  // Add user-specific prompts
  if (payload?.user) {
    prompts.push({
      name: 'user_context',
      description: `Context for ${payload.user}`,
      arguments: [],
      content: `You are assisting user: ${payload.user}`,
    });
  }

  // Add transport-specific prompts
  if (transport === 'http') {
    prompts.push({
      name: 'http_mode',
      description: 'HTTP-specific instructions',
      arguments: [],
      content: 'Respond in JSON format for HTTP clients',
    });
  }

  return prompts;
};
```

## Resources

### Standard Resources

| URI | MIME | Description |
|-----|------|-------------|
| `project://id` | `text/plain` | Service identifier (`appConfig.name`) |
| `project://name` | `text/plain` | Display name (`appConfig.productName`) |
| `project://version` | `text/plain` | Server version (`appConfig.version`) — mirror of `GET /health.version` and `serverInfo.version` (standard §4 SHOULD) |
| `doc://readme` | `text/markdown` | README.md content |
| `use://http-headers` | `application/json` | Used HTTP headers (from `usedHttpHeaders`) |
| `use://auth` | `application/json` | Enabled auth schemes / methods / expected JWT claims (standard §11.2 SHOULD) |
| `<appConfig.name>://agent/brief` | `text/markdown` | Mirror of `agent_brief` prompt (Avatar profile §11.2) |
| `<appConfig.name>://agent/prompt` | `text/markdown` | Mirror of `agent_prompt` prompt (Avatar profile §11.2) |

> The `<appConfig.name>://agent/*` URIs are built automatically from `appConfig.name`
> (e.g. `mcp-jira://agent/brief`). If a project's `customResources` list contains a
> resource with the same URI, the project-supplied entry wins — handy when the service
> needs to publish a different brief through the resources endpoint than through prompts.

### Custom Resources

Add in `src/custom-resources.ts`:

```typescript
import { IResourceData } from 'fa-mcp-sdk';

export const customResources: IResourceData[] = [
  { uri: 'custom://config', name: 'Config', description: 'Server config',
    mimeType: 'text/plain', content: 'Version: 1.0.0' },

  { uri: 'custom://schema', name: 'API Schema', description: 'API schema',
    mimeType: 'application/json',
    content: { version: '1.0', endpoints: ['/api/users'] } },

  { uri: 'custom://status', name: 'Status', description: 'Live status',
    mimeType: 'application/json',
    content: async (uri) => JSON.stringify(await getStatus()) },

  { uri: 'custom://secrets', name: 'Secrets', description: 'Protected',
    mimeType: 'application/json', content: {}, requireAuth: true },
];
```

Pass to server:
```typescript
const serverData: McpServerData = { ..., customResources };
```

### Dynamic Resources (Function)

For dynamic resource lists based on transport type, headers, or user:

```typescript
import { IResourceData, ITransportContext } from 'fa-mcp-sdk';

export const customResources = async (ctx: ITransportContext): Promise<IResourceData[]> => {
  const { transport, headers, payload } = ctx;

  const resources: IResourceData[] = [
    { uri: 'custom://config', name: 'Config', description: 'Server config',
      mimeType: 'text/plain', content: 'Version: 1.0.0' },
  ];

  // Add user-specific resources
  if (payload?.user) {
    resources.push({
      uri: `user://${payload.user}/preferences`,
      name: 'User Preferences',
      description: `Preferences for ${payload.user}`,
      mimeType: 'application/json',
      content: await getUserPreferences(payload.user),
    });
  }

  return resources;
};
```

### Used HTTP Headers

Define required client headers:

```typescript
const serverData: McpServerData = {
  ...,
  usedHttpHeaders: [
    { name: 'Authorization', description: 'JWT token in Bearer format' },
    { name: 'X-Request-ID', description: 'Request tracking ID', isOptional: true },
  ],
};
```

Exposed via `use://http-headers` resource.

## requireAuth

Both prompts and resources support `requireAuth: true`:

- Requires valid authentication to access
- Unauthenticated requests get error
- Works with any configured auth method (JWT, Basic, etc.)

## Optional MAY capabilities — templates & subscribe (standard §11.5)

Disabled by default. Opt-in via `config/default.yaml`:

```yaml
mcp:
  resources:
    subscribeEnabled: false   # MAY §11.5 — turn on only when resources change at runtime
    templatesEnabled: false   # MAY §11.5 — turn on when you publish customResourceTemplates
```

### `resources/templates/list`

When `templatesEnabled: true`, register `customResourceTemplates` on `McpServerData`:

```typescript
import { IResourceTemplateInfo, McpServerData } from 'fa-mcp-sdk';

const customResourceTemplates: IResourceTemplateInfo[] = [
  {
    uriTemplate: 'issue://{key}',                         // RFC 6570
    name: 'jira-issue',
    title: 'Jira issue by key',
    description: 'Single Jira issue addressable by ticket key.',
    mimeType: 'application/json',
  },
];

const serverData: McpServerData = { ..., customResourceTemplates };
```

If you do not register any templates the server still answers `resources/templates/list`
with an empty array — clients can probe the capability safely.

### `resources/subscribe` + change notifications

When `subscribeEnabled: true`, the server advertises `subscribe` and `listChanged` in its
`resources` capability. To notify subscribers when content changes call
`notifyResourceUpdated(server, uri)`:

```typescript
import { notifyResourceUpdated } from 'fa-mcp-sdk';

// Each HTTP session owns its own Server instance — track the server reference at the
// point where you have it (e.g. inside a custom-resources content function).
await notifyResourceUpdated(server, 'project://version');
```

The helper emits `notifications/resources/updated` only to clients that previously called
`resources/subscribe` for the given URI on that `Server`.

## Pagination (standard §8.4)

`prompts/list` and `resources/list` use the same cursor-based pagination as `tools/list`:
opaque base64(offset), stable sort by `name` / `uri`. The page size comes from
`mcp.pagination.pageSize` (default 100). See [03-configuration → "Pagination"](./03-configuration.md#pagination).
