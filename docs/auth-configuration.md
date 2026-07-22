# Auth Configuration for Resources and Prompts

This document describes how to configure authentication requirements for MCP resources and prompts.

## Overview

MCP endpoints than not require authentication:
- ping
- initialize
- notifications/initialized
- tools/list
- prompts/list
- resources/list

For the specific prompts or resources you can now configure whether they should 
be accessible with authentication by setting the `requireAuth` property to `true`.

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

Resources and prompts Public by default (`requireAuth: false`)

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

1. **Sensitive Data**: Never make resources or prompts containing sensitive information public.
2. **Access Logs**: Monitor access to public resources to detect potential abuse.
3. **Regular Review**: Periodically review which resources are public and adjust as needed.

## Implementation Details

The authentication check happens in the universal `createAuthMW` middleware in `src/core/auth/middleware.ts`. The middleware:

### HTTP MCP Endpoint (`/mcp`)
1. Checks if the request is for the `/mcp` endpoint
2. Determines if it's a resource or prompt request
3. When auth is enabled, requires credentials for `tools/list`, `resources/list`, and `prompts/list`
4. For `resources/read`: Checks if the specific resource is public
5. For `prompts/get`: Checks if the specific prompt is public
6. For all other methods: Requires authentication
7. Requires credentials for `initialize`, so every stateful session has an authenticated owner
8. Binds every stateful `MCP-Session-Id` to the credential/delegation digest established by `initialize`; a different
   valid principal receives HTTP 403 before POST, GET, or DELETE reaches that session's transport

### SSE Endpoints (`/sse`, `/messages`)
These deprecated endpoints are absent by default. For a documented migration window, set
`mcp.legacySse.enabled: true`. When enabled, the universal auth middleware also handles SSE endpoints:
1. Checks if request is for `/sse`, `/messages`, or `/mcp`
2. Applies the same public resource/prompt logic as HTTP MCP
3. Requires credentials for all catalog lists when auth is enabled
4. Requires authentication for SSE connection establishment (`GET /sse`) and all other operations

### Important Note on SSE
- **GET `/sse`**: Always requires authentication (connection establishment)
- **POST `/sse`**: Requires the same credential binding that opened the selected SSE session
- **POST `/messages`**: Requires the same credential binding and the explicit `sessionId`

Tool calls pass through the same scope, schema, concurrency, timeout, output-schema and result-size
pipeline as Streamable HTTP; the legacy adapter does not own a second dispatcher.
