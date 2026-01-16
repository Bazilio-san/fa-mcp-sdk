# Tools and REST API Development

## Tool Development

### Tool Definition in `src/tools/tools.ts`

```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IToolInputSchema } from 'fa-mcp-sdk';

export const tools: Tool[] = [
  {
    name: 'my_custom_tool',
    description: 'Description of what this tool does',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Input query or text',
        },
        options: {
          type: 'object',
          description: 'Optional configuration',
        },
      },
      required: ['query'],
    },
  },
];
```

### Tool Handler in `src/tools/handle-tool-call.ts`

```typescript
import { formatToolResult, ToolExecutionError, logger } from 'fa-mcp-sdk';

export const handleToolCall = async (params: { name: string, arguments?: any, headers?: Record<string, string> }): Promise<any> => {
  const { name, arguments: args, headers } = params;

  logger.info(`Tool called: ${name}`);

  // Access normalized HTTP headers (all header names are lowercase)
  if (headers) {
    const authHeader = headers.authorization;
    const userAgent = headers['user-agent'];
    const customHeader = headers['x-custom-header'];
    logger.info(`Headers available: authorization=${!!authHeader}, user-agent=${userAgent}`);
  }

  try {
    switch (name) {
      case 'my_custom_tool':
        return await handleMyCustomTool(args);

      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool execution failed for ${name}:`, error);
    throw error;
  }
};

async function handleMyCustomTool(args: any): Promise<string> {
  const { query, options } = args || {};

  if (!query) {
    throw new ToolExecutionError('my_custom_tool', 'Query parameter is required');
  }

  // Your tool logic here
  const result = {
    message: `Processed: ${query}`,
    timestamp: new Date().toISOString(),
    options: options || {},
  };

  return formatToolResult(result);
}
```

### HTTP Headers in Tool Handler

The FA-MCP-SDK automatically passes normalized HTTP headers to your `toolHandler` function, enabling context-aware tool execution based on client information.

**Key Features:**
- All headers are automatically normalized to lowercase
- Available in both HTTP and SSE transports (SSE provides empty headers object)
- Headers are sanitized and only string values are passed
- Array header values are joined with `', '` separator

**Example Usage:**

```typescript
export const handleToolCall = async (params: {
  name: string,
  arguments?: any,
  headers?: Record<string, string>
}): Promise<any> => {
  const { name, arguments: args, headers } = params;

  // Access client information via headers
  if (headers) {
    const authHeader = headers.authorization;           // Lowercase normalized
    const userAgent = headers['user-agent'];           // Browser/client info
    const clientIP = headers['x-real-ip'] || headers['x-forwarded-for'];  // Proxy headers
    const customData = headers['x-custom-header'];     // Custom headers

    logger.info(`Tool ${name} called by ${userAgent} from IP ${clientIP}`);

    // Conditional logic based on client
    if (userAgent?.includes('mobile')) {
      return await handleMobileRequest(args);
    }

    // Custom authorization beyond standard auth
    if (customData === 'admin-mode' && authHeader) {
      return await handleAdminRequest(args);
    }
  }

  // Regular tool logic
  switch (name) {
    case 'get_user_data':
      // Use headers for audit logging
      return await getUserData(args, {
        clientIP: headers?.['x-real-ip'],
        userAgent: headers?.['user-agent']
      });
  }
};
```

**Header Normalization Details:**

```typescript
// Original headers from client:
{
  'Authorization': 'Bearer token123',
  'X-Custom-Header': 'value',
  'USER-AGENT': 'MyClient/1.0'
}

// Normalized headers passed to toolHandler:
{
  'authorization': 'Bearer token123',
  'x-custom-header': 'value',
  'user-agent': 'MyClient/1.0'
}
```

**Transport Differences:**

- **HTTP Transport**: Full headers available from Express request object
- **SSE Transport**: Headers preserved from initial SSE connection establishment (GET /sse request)

**Common Use Cases:**
- Client identification and analytics
- Custom authorization checks beyond standard authentication
- Request routing based on client capabilities
- Audit logging with client context
- Rate limiting per client type

---

## REST API Endpoints

The SDK supports custom REST API endpoints alongside MCP tools. Define your endpoints in `src/api/router.ts` using [tsoa](https://tsoa-community.github.io/docs/) decorators for automatic OpenAPI/Swagger documentation generation.

### OpenAPI Generation

**Swagger is generated automatically** when the server starts if `swagger/openapi.yaml` doesn't exist. The specification is built from tsoa-decorated controllers in your `src/api/` directory.

- **Swagger UI**: Available at `/docs`
- **OpenAPI spec**: Available at `/api/openapi.json` and `/api/openapi.yaml`

To regenerate the spec, simply delete `swagger/openapi.yaml` and restart the server.

### Basic Controller Example

**`src/api/router.ts`:**
```typescript
import { Router } from 'express';
import { Route, Get, Post, Body, Tags, Query } from 'tsoa';
import { logger } from 'fa-mcp-sdk';

export const apiRouter: Router = Router();

// Response interfaces for tsoa (used in OpenAPI schema generation)
export interface UserResponse {
  id: string;
  name: string;
  email: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
}

/**
 * User Management Controller
 * All methods in this class will be under /api prefix
 */
@Route('api')
export class UserController {
  /**
   * Get user by ID
   * @param userId The user's unique identifier
   */
  @Get('users/{userId}')
  @Tags('Users')
  public async getUser(userId: string): Promise<UserResponse> {
    logger.info(`Getting user: ${userId}`);
    return {
      id: userId,
      name: 'John Doe',
      email: 'john@example.com',
    };
  }

  /**
   * Create a new user
   */
  @Post('users')
  @Tags('Users')
  public async createUser(
    @Body() body: CreateUserRequest
  ): Promise<UserResponse> {
    logger.info(`Creating user: ${body.name}`);
    return {
      id: 'new-user-id',
      name: body.name,
      email: body.email,
    };
  }

  /**
   * Search users by query
   */
  @Get('users')
  @Tags('Users')
  public async searchUsers(
    @Query() query?: string,
    @Query() limit?: number
  ): Promise<UserResponse[]> {
    logger.info(`Searching users: ${query}, limit: ${limit}`);
    return [];
  }
}
```

### Tags Organization

Use `@Tags()` decorator to organize endpoints in Swagger UI:

```typescript
@Route('api')
export class MyController {
  // This endpoint appears in "Users" section
  @Get('users')
  @Tags('Users')
  public async listUsers(): Promise<User[]> { ... }

  // This endpoint appears in "Admin" section
  @Get('admin/stats')
  @Tags('Admin')
  public async getStats(): Promise<Stats> { ... }

  // This endpoint appears in BOTH sections
  @Get('admin/users')
  @Tags('Admin', 'Users')
  public async adminListUsers(): Promise<User[]> { ... }
}
```

**Important**: Apply `@Tags()` to individual methods, not the class. Class-level `@Tags()` applies to ALL methods, which may cause unintended grouping.

### Common tsoa Decorators

| Decorator | Usage | Example |
|-----------|-------|---------|
| `@Route('prefix')` | Set route prefix | `@Route('api')` |
| `@Get('path')` | GET endpoint | `@Get('users/{id}')` |
| `@Post('path')` | POST endpoint | `@Post('users')` |
| `@Put('path')` | PUT endpoint | `@Put('users/{id}')` |
| `@Delete('path')` | DELETE endpoint | `@Delete('users/{id}')` |
| `@Tags('name')` | Swagger section | `@Tags('Users')` |
| `@Body()` | Request body | `@Body() data: CreateRequest` |
| `@Query()` | Query parameter | `@Query() search?: string` |
| `@Path()` | Path parameter | `@Path() id: string` |
| `@Header()` | Header value | `@Header('x-api-key') apiKey: string` |

### Manual Express Routes

For endpoints not requiring OpenAPI documentation, use standard Express routing:

```typescript
import { Router } from 'express';
import { createAuthMW } from 'fa-mcp-sdk';

export const apiRouter: Router = Router();

const authMW = createAuthMW();

// Manual route with authentication
apiRouter.get('/internal/status', authMW, (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// tsoa controllers are still processed for OpenAPI generation
@Route('api')
export class PublicController {
  @Get('health')
  @Tags('Server')
  public async health(): Promise<{ status: string }> {
    return { status: 'healthy' };
  }
}
```

---

## OpenAPI/Swagger API Reference

### Types

```typescript
import {
  configureOpenAPI,
  createSwaggerUIAssetsMiddleware,
  OpenAPISpecResponse,
  SwaggerUIConfig
} from 'fa-mcp-sdk';
```

### `OpenAPISpecResponse`

Type representing the OpenAPI 3.0 specification structure.

```typescript
interface OpenAPISpecResponse {
  openapi: string;                  // '3.0.0'
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, any>;       // API endpoint definitions
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
  tags?: Array<{
    name: string;
    description: string;
  }>;
}
```

### `SwaggerUIConfig`

Configuration options for customizing Swagger UI appearance and behavior.

```typescript
interface SwaggerUIConfig {
  customCss?: string;               // Custom CSS overrides
  customSiteTitle?: string;         // Browser tab title
  customfavIcon?: string;           // Custom favicon URL
  swaggerOptions?: {
    persistAuthorization?: boolean;       // Remember auth between reloads
    displayRequestDuration?: boolean;     // Show request timing
    docExpansion?: 'none' | 'list' | 'full';  // Default expansion
    defaultModelsExpandDepth?: number;    // Schema expansion depth
    urls?: Array<{                        // Multiple spec sources
      name: string;
      url: string;
    }>;
  };
}
```

### `configureOpenAPI()`

Automatically configures and serves OpenAPI documentation for APIs with tsoa decorators. Called internally by `initMcpServer()` when `httpComponents.apiRouter` is provided.

```typescript
// Function Signature:
async function configureOpenAPI(apiRouter?: Router | null): Promise<{
  swaggerUi?: any;
  swaggerSpecs?: any;
} | null>;

// Behavior:
// 1. Checks for swagger/openapi.yaml in project root
// 2. If not found, generates spec using tsoa programmatic API
// 3. Enhances spec with app configuration (servers, auth, info)
// 4. Creates /api/openapi.json and /api/openapi.yaml endpoints
// 5. Returns Swagger UI middleware for /docs endpoint

// The function is called automatically - typically no manual invocation needed
// To customize, modify config/default.yaml:

// config/default.yaml
swagger:
  servers:
    - url: 'https://api.production.com'
      description: 'Production server'
    - url: 'https://api.staging.com'
      description: 'Staging server'
```

### `createSwaggerUIAssetsMiddleware()`

Creates Express middleware for serving Swagger UI static assets. Used internally to set up the `/docs` endpoint.

```typescript
import { createSwaggerUIAssetsMiddleware } from 'fa-mcp-sdk';

// Function Signature:
function createSwaggerUIAssetsMiddleware(): RequestHandler[];

// Returns swagger-ui-express.serve middleware array
// Typically used internally by configureOpenAPI()

// Manual usage (advanced):
import express from 'express';
const app = express();

app.use('/docs', createSwaggerUIAssetsMiddleware(), swaggerUiSetup);
```

### OpenAPI Specification Generation

The OpenAPI specification is generated automatically when the server starts:

1. **Automatic Generation**: If `swagger/openapi.yaml` doesn't exist, it's generated from tsoa-decorated controllers
2. **Manual Regeneration**: Delete `swagger/openapi.yaml` and restart the server
3. **Source Files**: Controllers in `src/api/*.ts` are scanned for decorators

**Generated Spec Location:**
- `swagger/openapi.yaml` - YAML format (primary)
- Runtime endpoints: `/api/openapi.json`, `/api/openapi.yaml`

**Accessing Documentation:**
- Swagger UI: `http://localhost:{port}/docs`
- Raw spec: `http://localhost:{port}/api/openapi.json`

### Configuration via YAML

```yaml
# config/default.yaml
swagger:
  servers:
    - url: 'http://localhost:3000'
      description: 'Development server'
    - url: 'https://api.example.com'
      description: 'Production server'

webServer:
  auth:
    enabled: true  # Adds Bearer auth to OpenAPI spec
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
