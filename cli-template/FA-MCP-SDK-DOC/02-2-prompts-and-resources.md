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
import { IPromptData, IGetPromptRequest } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  { name: 'greeting', description: 'Greeting message', arguments: [],
    content: 'Hello! How can I help?' },

  { name: 'context_prompt', description: 'Context-aware', arguments: [],
    content: (req: IGetPromptRequest) => `Context: ${JSON.stringify(req.params.arguments)}` },

  { name: 'admin_only', description: 'Admin instructions', arguments: [],
    content: 'Admin-only content', requireAuth: true },
];
```

Pass to server:
```typescript
const serverData: McpServerData = { ..., customPrompts };
```

## Resources

### Standard Resources

| URI | Description |
|-----|-------------|
| `project://id` | Service identifier (`appConfig.name`) |
| `project://name` | Display name (`appConfig.productName`) |
| `doc://readme` | README.md content |
| `use://http-headers` | Required HTTP headers (from `usedHttpHeaders`) |

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
