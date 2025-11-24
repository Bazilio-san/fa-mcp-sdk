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

The authentication check happens in the `authTokenMW` middleware in `src/core/token/token-auth.ts`. The middleware:

1. Checks if the request is for the `/mcp` endpoint
2. Determines if it's a resource or prompt request
3. For `resources/list` and `prompts/list`: Always allows access
4. For `resources/read`: Checks if the specific resource is public
5. For `prompts/get`: Checks if the specific prompt is public
6. For all other methods: Requires authentication

This ensures that only the intended public resources and prompts are accessible without authentication while maintaining security for all other operations.