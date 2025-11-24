# Auth Configuration for Resources and Prompts

This document describes how to configure authentication requirements for MCP resources and prompts.

## Overview

By default, all MCP endpoints require authentication. However, you can now configure specific resources and prompts to be accessible without authentication by setting the `requireAuth` property.

## Built-in Public Resources and Prompts

The following built-in resources and prompts are configured as public (no authentication required):

### Resources
- `project://id` - Project identifier
- `project://name` - Product name
- `doc://readme` - README documentation

### Prompts
- `agent_brief` - Brief agent description
- `agent_prompt` - Detailed agent prompt

## Configuration

### Custom Resources

To make a custom resource public, set `requireAuth: false`:

```typescript
const customResources: IResourceData[] = [
  {
    uri: 'public://info',
    name: 'public-info',
    description: 'Public information accessible without auth',
    mimeType: 'text/plain',
    content: 'This is public content',
    requireAuth: false, // This makes the resource public
  },
  {
    uri: 'private://sensitive',
    name: 'sensitive-data',
    description: 'Sensitive data requiring authentication',
    mimeType: 'application/json',
    content: { secret: 'data' },
    requireAuth: true, // This requires authentication (default behavior)
  },
];
```

### Custom Prompts

To make a custom prompt public, set `requireAuth: false`:

```typescript
const customPrompts: IPromptData[] = [
  {
    name: 'public_help',
    description: 'Public help prompt',
    arguments: [],
    content: 'This is a public help prompt',
    requireAuth: false, // This makes the prompt public
  },
  {
    name: 'private_operations',
    description: 'Private operations requiring auth',
    arguments: [],
    content: 'This prompt requires authentication',
    requireAuth: true, // This requires authentication (default behavior)
  },
];
```

## Default Behavior

- **Built-in resources and prompts**: Public by default (`requireAuth: false`)
- **Custom resources and prompts**: Private by default (if `requireAuth` is not specified, authentication is required)
- **Unknown resources/prompts**: Authentication required (security-first approach)

## API Access

### Public Resources

#### HTTP MCP Endpoint
```bash
# Get public resources list (no auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "resources/list",
    "id": 1
  }'

# Get specific public resource (no auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "resources/read",
    "params": {
      "uri": "project://name"
    },
    "id": 1
  }'
```

#### SSE (Server-Sent Events) Endpoint
```bash
# SSE connection for public resources (no auth required for resource operations)
curl -X GET http://localhost:3000/sse

# Send resource request via SSE POST (no auth required for public resources)
curl -X POST http://localhost:3000/sse \
  -H "Content-Type: application/json" \
  -d '{
    "method": "resources/list",
    "id": 1
  }'

# Send specific resource request via SSE POST (no auth required for public resources)
curl -X POST http://localhost:3000/sse \
  -H "Content-Type: application/json" \
  -d '{
    "method": "resources/read",
    "params": {
      "uri": "project://name"
    },
    "id": 1
  }'

# Send resource request via /messages endpoint with session (no auth required for public resources)
curl -X POST "http://localhost:3000/messages?sessionId=YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "resources/list",
    "id": 1
  }'
```

### Private Resources

```bash
# Get private resource (auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "method": "resources/read",
    "params": {
      "uri": "private://sensitive"
    },
    "id": 1
  }'
```

### Public Prompts

#### HTTP MCP Endpoint
```bash
# Get public prompts list (no auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "prompts/list",
    "id": 1
  }'

# Get specific public prompt (no auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "prompts/get",
    "params": {
      "name": "agent_brief"
    },
    "id": 1
  }'
```

#### SSE (Server-Sent Events) Endpoint
```bash
# Send prompts request via SSE POST (no auth required for public prompts)
curl -X POST http://localhost:3000/sse \
  -H "Content-Type: application/json" \
  -d '{
    "method": "prompts/list",
    "id": 1
  }'

# Send specific prompt request via SSE POST (no auth required for public prompts)
curl -X POST http://localhost:3000/sse \
  -H "Content-Type: application/json" \
  -d '{
    "method": "prompts/get",
    "params": {
      "name": "agent_brief"
    },
    "id": 1
  }'

# Send prompt request via /messages endpoint with session (no auth required for public prompts)
curl -X POST "http://localhost:3000/messages?sessionId=YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "prompts/list",
    "id": 1
  }'
```

### Private Prompts

```bash
# Get private prompt (auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "method": "prompts/get",
    "params": {
      "name": "private_operations"
    },
    "id": 1
  }'
```

## Security Considerations

1. **Default to Private**: Always explicitly set `requireAuth: false` for public resources. Don't rely on defaults.
2. **Sensitive Data**: Never make resources or prompts containing sensitive information public.
3. **Access Logs**: Monitor access to public resources to detect potential abuse.
4. **Regular Review**: Periodically review which resources are public and adjust as needed.

## Implementation Details

The authentication check happens in the `authTokenMW` and `createConditionalAuthMiddleware` middleware in `src/core/token/token-auth.ts`. The middleware:

### HTTP MCP Endpoint (`/mcp`)
1. Checks if the request is for the `/mcp` endpoint
2. Determines if it's a resource or prompt request
3. For `resources/list` and `prompts/list`: Always allows access
4. For `resources/read`: Checks if the specific resource is public
5. For `prompts/get`: Checks if the specific prompt is public
6. For all other methods: Requires authentication

### SSE Endpoints (`/sse`, `/messages`)
The conditional auth middleware also handles SSE endpoints:
1. Checks if request is for `/sse`, `/messages`, or `/mcp`
2. Applies the same public resource/prompt logic as HTTP MCP
3. Allows public access to `resources/list`, `prompts/list`, and specific public resources/prompts
4. Requires authentication for SSE connection establishment (`GET /sse`) and all other operations

### Important Note on SSE
- **GET `/sse`**: Always requires authentication (connection establishment)
- **POST `/sse`**: Uses conditional auth (public operations allowed without token)
- **POST `/messages`**: Uses conditional auth (public operations allowed without token)

This ensures that only the intended public resources and prompts are accessible without authentication while maintaining security for all other operations, including SSE connection establishment.