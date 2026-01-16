# Authentication and Security

## Authentication Types

### `TTokenType`

Type identifier for authentication methods. Used to indicate which authentication mechanism was used for a request.

```typescript
import { TTokenType } from 'fa-mcp-sdk';

// Type Definition:
type TTokenType = 'permanent' | 'JWT';

// Usage in authentication results:
interface AuthResult {
  success: boolean;
  authType?: TTokenType;  // Indicates which auth method succeeded
  username?: string;
  // ...
}
```

| Value | Description |
|-------|-------------|
| `'permanent'` | Permanent server token from `permanentServerTokens` config |
| `'JWT'` | JSON Web Token authentication |

---

## Token-based Authentication

```typescript
import {
  ICheckTokenResult,
  ITokenPayload,
  generateToken
} from 'fa-mcp-sdk';

// Note: checkJwtToken is internal. Use createAuthMW() or getMultiAuthError() for authentication.

// Types used:
export interface ICheckTokenResult {
  payload?: ITokenPayload,          // Token payload with user data
  errorReason?: string,             // Error message if validation failed
  isTokenDecrypted?: boolean,       // Whether token was successfully decrypted
}

export interface ITokenPayload {
  user: string,                     // Username
  expire: number,                   // Expiration timestamp
  [key: string]: any,               // Additional payload data
}

// Note: Token validation is handled automatically by createAuthMW() middleware.
// For programmatic validation, use getMultiAuthError() which supports all auth methods.

// generateToken - create JWT token
// Function Signature:
const generateToken = (user: string, liveTimeSec: number, payload?: any): string {...}

// Example:
const token = generateToken('john_doe', 3600, { role: 'admin' }); // 1 hour token

// Deprecated: authByToken was replaced by createAuthMW universal middleware
// Use createAuthMW instead for all authentication scenarios:

// Example - Modern approach:
app.post('/api/secure', createAuthMW(), (req, res) => {
  // User is authenticated, authInfo available on req
  const authInfo = (req as any).authInfo;
  res.json({
    message: 'Access granted',
    authType: authInfo?.authType,
    username: authInfo?.username
  });
});
```

## Test Authentication Headers

```typescript
import { getAuthHeadersForTests } from 'fa-mcp-sdk';

// getAuthHeadersForTests - automatically generate authentication headers for testing
// Function Signature:
function getAuthHeadersForTests(): object {...}

// Determines authentication headers based on appConfig.webServer.auth configuration.
// Returns Authorization header using the first valid auth method found.
//
// Priority order (CPU-optimized, fastest first):
// 1. permanentServerTokens - if at least one token is defined
// 2. basic auth - if username AND password are both set
// 3. JWT token - if jwtToken.encryptKey is set, generates token on the fly
//
// Returns empty object if auth is not enabled or no valid method configured.

// Examples:
const headers = getAuthHeadersForTests();

// Use in fetch requests
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...headers  // Automatically adds Authorization header if auth is enabled
  },
  body: JSON.stringify(requestBody)
});

// Use with test clients
import { McpHttpClient } from 'fa-mcp-sdk';

const client = new McpHttpClient('http://localhost:3000');
const authHeaders = getAuthHeadersForTests();
const result = await client.callTool('my_tool', { query: 'test' }, authHeaders);

// Return value examples based on configuration:

// If permanentServerTokens configured:
// { Authorization: 'Bearer server-token-1' }

// If basic auth configured:
// { Authorization: 'Basic YWRtaW46cGFzc3dvcmQ=' }  // base64 of 'admin:password'

// If JWT encryptKey configured:
// { Authorization: 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...' }

// If auth.enabled = false or no valid method:
// {}

// Typical test setup:
import { getAuthHeadersForTests, appConfig } from 'fa-mcp-sdk';

describe('MCP Server Tests', () => {
  const baseUrl = `http://localhost:${appConfig.webServer.port}`;
  const authHeaders = getAuthHeadersForTests();

  it('should call tool with authentication', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'my_tool', arguments: { query: 'test' } },
        id: 1
      })
    });

    expect(response.ok).toBe(true);
  });
});
```

## Token Generator Authorization Handler

The Token Generator admin page (`/admin/`) can be protected with an additional
custom authorization layer beyond the standard authentication. This allows you
to implement fine-grained access control, such as restricting access to specific
AD groups or roles.

### Types

```typescript
import { TokenGenAuthHandler, TokenGenAuthInput, AuthResult } from 'fa-mcp-sdk';

// Input data passed to the authorization handler
interface TokenGenAuthInput {
  user: string;                    // Username from authentication
  domain?: string;                 // Domain (only for NTLM auth)
  payload?: Record<string, any>;   // JWT payload (only for jwtToken auth)
  authType: 'jwtToken' | 'basic' | 'ntlm' | 'permanentServerTokens';
}

// Authorization handler function type
type TokenGenAuthHandler = (input: TokenGenAuthInput) => Promise<AuthResult> | AuthResult;
```

### Configuration

Add `tokenGenAuthHandler` to your `McpServerData` in `src/start.ts`:

```typescript
import { initMcpServer, McpServerData, TokenGenAuthHandler, initADGroupChecker } from 'fa-mcp-sdk';

// Example 1: Restrict to specific AD groups (NTLM authentication)
const { isUserInGroup } = initADGroupChecker();

const tokenGenAuthHandler: TokenGenAuthHandler = async (input) => {
  // Only check for NTLM-authenticated users
  if (input.authType === 'ntlm') {
    const isAdmin = await isUserInGroup(input.user, 'TokenGeneratorAdmins');
    if (!isAdmin) {
      return {
        success: false,
        error: `User ${input.user} is not authorized to access Token Generator`,
      };
    }
  }
  return { success: true, username: input.user };
};

// Example 2: Check JWT payload for specific claims
const tokenGenAuthHandler: TokenGenAuthHandler = async (input) => {
  if (input.authType === 'jwtToken') {
    const roles = input.payload?.roles || [];
    if (!roles.includes('token-admin')) {
      return {
        success: false,
        error: 'Missing required role: token-admin',
      };
    }
  }
  return { success: true, username: input.user };
};

// Example 3: Simple whitelist check
const allowedUsers = ['admin', 'john.doe', 'jane.smith'];

const tokenGenAuthHandler: TokenGenAuthHandler = (input) => {
  if (!allowedUsers.includes(input.user.toLowerCase())) {
    return {
      success: false,
      error: `User ${input.user} is not in the allowed users list`,
    };
  }
  return { success: true, username: input.user };
};

// Use in McpServerData
const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: AGENT_BRIEF,
  agentPrompt: AGENT_PROMPT,

  // Add custom authorization for Token Generator
  tokenGenAuthHandler,

  // ... other configuration
};

await initMcpServer(serverData);
```

### Behavior

- **If `tokenGenAuthHandler` is not provided**: All authenticated users can access Token Generator
- **If handler returns `{ success: true }`**: User is authorized
- **If handler returns `{ success: false, error: '...' }`**: User receives 403 Forbidden with error message
- **Handler errors**: Caught and returned as 403 with error message

### Auth Type Input Details

| Auth Type | `user` | `domain` | `payload` |
|-----------|--------|----------|-----------|
| `ntlm` | NTLM username | NTLM domain | - |
| `basic` | Basic auth username | - | - |
| `jwtToken` | JWT `user` claim | - | Full JWT payload |
| `permanentServerTokens` | "Unknown" | - | - |

---

## Multi-Authentication System

The FA-MCP-SDK supports a comprehensive multi-authentication system that allows multiple authentication methods to work together with CPU-optimized performance ordering.

### Types and Interfaces

```typescript
import {
  AuthType,
  AuthResult,
  AuthDetectionResult,
  CustomAuthValidator,
  checkMultiAuth,
  detectAuthConfiguration,
  logAuthConfiguration,
  createAuthMW,         // Universal authentication middleware
  getMultiAuthError,    // Programmatic authentication checking
} from 'fa-mcp-sdk';

// Authentication types in CPU priority order (low to high cost)
export type AuthType = 'permanentServerTokens' | 'jwtToken' | 'basic' | 'custom';

// Custom Authentication validator function (black box - receives full request)
export type CustomAuthValidator = (req: any) => Promise<AuthResult> | AuthResult;

// Authentication result interface
export interface AuthResult {
   success: boolean;
   error?: string;
   authType?: AuthType;
   username?: string;
   isTokenDecrypted?: boolean; // only for JWT
   payload?: any;
}

// Authentication detection result
export interface AuthDetectionResult {
  configured: AuthType[];           // Authentication types found in configuration
  configuredSet: Set<AuthType>;     // Set of configured auth types for quick lookup
  configuredTypes: string;          // Comma-separated string of configured types
  errors: Record<string, string[]>; // Configuration errors by auth type
}
```

### Core Multi-Authentication Functions

```typescript
// checkMultiAuth - validate using all configured authentication methods
// Function Signature:
async function checkMultiAuth(req: Request): Promise<AuthResult> {...}

// Example:
const result = await checkMultiAuth(req);

if (result.success) {
  console.log(`Authenticated via ${result.authType} as ${result.username}`);
} else {
  console.log('Authentication failed:', result.error);
}

// detectAuthConfiguration - analyze auth configuration
// Function Signature:
function detectAuthConfiguration(): AuthDetectionResult {...}

// Example:
const detection = detectAuthConfiguration();
console.log('Configured auth types:', detection.configured);
console.log('Configured types string:', detection.configuredTypes);
console.log('Configuration errors:', detection.errors);

// logAuthConfiguration - log auth system status (debugging)
// Function Signature:
function logAuthConfiguration(): void {...}

// Example:
logAuthConfiguration();
// Output:
// Auth system configuration:
// - enabled: true
// - configured types: permanentServerTokens, basic
```

### Multi-Authentication Middleware

```typescript
import express from 'express';
import {
  createAuthMW,
  getMultiAuthError,
} from 'fa-mcp-sdk';

// Universal authentication middleware with flexible options
const app = express();

// Basic usage - handles all authentication scenarios automatically
const authMW = createAuthMW();
app.use('/api', authMW);

app.get('/api/protected', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({
    message: 'Access granted',
    authType: authInfo?.authType,
    username: authInfo?.username,
  });
});

// Advanced usage with custom options
const customAuthMW = createAuthMW({
  mcpPaths: ['/mcp', '/messages', '/sse', '/custom'],  // Custom MCP paths
  logConfig: true,                                     // Force logging
});
app.use('/custom-endpoints', customAuthMW);

// createAuthMW - Universal authentication middleware
// Function Signature:
function createAuthMW(options?: {
  mcpPaths?: string[];    // Paths to check for public MCP requests (default: ['/mcp', '/messages', '/sse'])
  logConfig?: boolean;    // Log auth configuration on first request (default: from LOG_AUTH_CONFIG env)
}): (req: Request, res: Response, next: NextFunction) => Promise<void>

// Features:
// ✅ Combines all authentication methods (standard + custom validator)
// ✅ Supports public MCP resources/prompts (requireAuth: false)
// ✅ Configurable MCP paths
// ✅ CPU-optimized authentication order
// ✅ Automatic auth method detection
// ✅ Request context enrichment (req.authInfo)

// getMultiAuthError - Programmatic authentication checking
// Function Signature:
async function getMultiAuthError(req: Request): Promise<{ code: number, message: string } | undefined>

// Returns error object if authentication failed, undefined if successful
// Uses checkMultiAuth internally - supports all authentication methods

// Example - Custom middleware with different auth levels
app.use('/api/custom', async (req, res, next) => {
  if (req.path.startsWith('/api/custom/public')) {
    return next(); // Public endpoints
  }

  if (req.path.startsWith('/api/custom/admin')) {
    // Admin endpoints - require server tokens only
    const token = (req.headers.authorization || '').replace(/^Bearer */, '');
    if (appConfig.webServer.auth.permanentServerTokens.includes(token)) {
      return next();
    }
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Regular endpoints - use full multi-auth
  try {
    const authError = await getMultiAuthError(req);
    if (authError) {
      res.status(authError.code).send(authError.message);
      return;
    }
    next();
  } catch (error) {
    res.status(500).send('Authentication error');
  }
});
```

### Custom Authentication

You can provide custom authentication validation functions through the `McpServerData` interface. The custom validator receives the full Express request object, allowing for flexible authentication logic:

```typescript
import { McpServerData, CustomAuthValidator } from 'fa-mcp-sdk';

// Database-backed authentication with request context
const databaseAuthValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  try {
    // Extract authentication data from various sources
    const authHeader = req.headers.authorization;
    const username = req.headers['x-username'];
    const apiKey = req.headers['x-api-key'];

    if (authHeader?.startsWith('Basic ')) {
      const [user, pass] = Buffer.from(authHeader.slice(6), 'base64').toString().split(':');
      const dbUser = await getUserFromDatabase(user);

      if (dbUser && await comparePassword(pass, dbUser.hashedPassword)) {
        return {
          success: true,
          authType: 'basic',
          username: dbUser.username,
          payload: { userId: dbUser.id, roles: dbUser.roles }
        };
      }
    }

    if (apiKey && username) {
      const isValid = await validateUserApiKey(username, apiKey);
      if (isValid) {
        return {
          success: true,
          authType: 'basic',
          username: username,
          payload: { apiKey: apiKey.substring(0, 8) + '...' }
        };
      }
    }

    return { success: false, error: 'Invalid credentials' };
  } catch (error) {
    console.error('Database authentication error:', error);
    return { success: false, error: 'Database authentication error' };
  }
};

// Use custom validator in MCP server
const serverData: McpServerData = {
  tools,
  toolHandler,
  agentBrief: 'My MCP Server',
  agentPrompt: 'Server with custom authentication',

  // Provide custom authentication validator (black box function)
  customAuthValidator: databaseAuthValidator,

  // ... other configuration
};

await initMcpServer(serverData);
```

### Client Usage Examples

```bash
# Using permanent server token
curl -H "Authorization: Bearer server-token-1" http://localhost:3000/mcp

# Using JWT token
curl -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhb..." http://localhost:3000/mcp

# Using Basic Authentication
curl -H "Authorization: Basic $(echo -n 'admin:password' | base64)" http://localhost:3000/mcp

# Using custom headers for custom validator
curl -H "X-User-ID: john.doe" \
     -H "X-API-Key: custom-api-key-12345" \
     -H "X-Client-IP: 192.168.1.10" \
     http://localhost:3000/mcp
```

The multi-authentication system automatically tries authentication methods in CPU-optimized order (fastest first) and returns on the first successful match, providing both performance and flexibility.

---

## AD Group Checking

### Configuration (`config/local.yaml`)

```yaml
ad:
  domains:
    MYDOMAIN:
      default: true
      controllers: ['ldap://dc1.corp.com']
      username: 'svc_account@corp.com'
      password: '***'
      # baseDn: 'DC=corp,DC=com'  # Optional, auto-derived from controller URL
```

### Usage

```typescript
import { initADGroupChecker } from 'fa-mcp-sdk';

const { isUserInGroup, groupChecker } = initADGroupChecker();

const isAdmin = await isUserInGroup('john.doe', 'Admins');
const isDeveloper = await isUserInGroup('john.doe', 'Developers');

groupChecker.clearCache();  // Clear cache if needed
```

---

## Advanced Authorization with AD Group Membership

See the separate documentation file `05-ad-authorization.md` for detailed examples of:

1. **HTTP Server Level Access Restriction** - Using `customAuthValidator`
2. **Access Restriction to ALL MCP Tools** - Checking in `toolHandler`
3. **Access Restriction to SPECIFIC MCP Tools** - Per-tool group requirements

---

## Token Generator Application

### `generateTokenApp()`

Launches a standalone Token Generator web application for administrative JWT token generation. The application provides a web UI for creating and validating tokens.

```typescript
import { generateTokenApp } from 'fa-mcp-sdk';

// Function Signature:
function generateTokenApp(port?: number): Server;

// Start Token Generator on default port (3030)
generateTokenApp();

// Start on custom port
generateTokenApp(8080);

// Can also be run directly from command line:
// npx ts-node node_modules/fa-mcp-sdk/dist/core/auth/token-generator/server.js
```

**Features:**
- Web UI for JWT token generation
- Token validation interface
- NTLM authentication support (if configured in AD settings)
- Service info endpoint with authentication status

**Environment Variables:**
- `TOKEN_GEN_PORT` - Override default port (3030)

**Endpoints:**

| Endpoint                    | Method | Description               |
|-----------------------------|--------|---------------------------|
| `/`                         | GET    | Token Generator web UI    |
| `/admin/api/generate-token` | POST   | Generate new JWT token    |
| `/admin/api/validate-token` | POST   | Validate existing token   |
| `/admin/api/service-info`   | GET    | Get service information   |
| `/admin/api/auth-status`    | GET    | Get authentication status |
| `/admin/logout`             | GET    | Logout endpoint           |

**Request Body for Token Generation:**

```typescript
interface GenerateTokenRequest {
  user: string;           // Username for the token
  timeValue: number;      // Duration value
  timeUnit: 'minutes' | 'hours' | 'days' | 'months' | 'years';
  payload?: Record<string, any>;  // Optional additional payload
}
```

**Example Usage:**

```typescript
// Programmatic token generation (without UI)
import { generateToken } from 'fa-mcp-sdk';

// Generate a 1-hour token
const token = generateToken('john.doe', 3600, { role: 'admin' });
console.log('Generated token:', token);

// Token validation is handled automatically by createAuthMW() middleware
// or use getMultiAuthError() for programmatic validation
```
