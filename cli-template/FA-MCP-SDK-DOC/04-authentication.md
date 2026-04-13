# Authentication

## Auth Types

```typescript
type TTokenType = 'permanent' | 'JWT';

interface AuthResult {
  success: boolean;
  error?: string;
  authType?: 'permanentServerTokens' | 'jwtToken' | 'basic' | 'custom';
  username?: string;
  isTokenDecrypted?: boolean;
  payload?: any;
}
```

## Token Operations

```typescript
import { generateToken } from 'fa-mcp-sdk';

// Generate JWT (liveTimeSec = seconds until expiry)
const token = generateToken('john_doe', 3600, { role: 'admin' }); // 1 hour
```

## Test Authentication

```typescript
import { getAuthHeadersForTests, McpHttpClient, appConfig } from 'fa-mcp-sdk';

// Auto-generates auth headers based on config (permanent → basic → JWT priority)
const headers = getAuthHeadersForTests();

// Usage
const response = await fetch(`http://localhost:${appConfig.webServer.port}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: {...}, id: 1 })
});

// With test client
const client = new McpHttpClient('http://localhost:3000');
const result = await client.callTool('tool', args, getAuthHeadersForTests());
```

## Admin Panel Authentication

The admin panel (`/admin`) supports 4 authentication types and can be configured with a single type or multiple types:

```yaml
# config/default.yaml
webServer:
  adminAuth:
    enabled: true
    # Single type (string)
    type: 'basic'
    # Or multiple types (array) — login page shows tabs to choose
    type: ['jwtToken', 'basic']
```

**Supported types:** `permanentServerTokens`, `basic`, `jwtToken`, `ntlm`

When multiple types are configured (e.g. `['jwtToken', 'basic']`), the login page shows tabs:
- **Token** tab — for `permanentServerTokens` and `jwtToken` authentication
- **Login** tab — for `basic` (username/password) authentication

For `permanentServerTokens`, `basic`, `jwtToken` — credentials are taken from `webServer.auth` section.
For `ntlm` — uses AD configuration from `ad.domains` section.

## Token Generator Authorization

Protect `/admin/` page with custom authorization:

```typescript
import { TokenGenAuthHandler, initADGroupChecker } from 'fa-mcp-sdk';

const { isUserInGroup } = initADGroupChecker();

const tokenGenAuthHandler: TokenGenAuthHandler = async (input) => {
  // input: { user, domain?, payload?, authType }
  if (input.authType === 'ntlm') {
    const isAdmin = await isUserInGroup(input.user, 'TokenGeneratorAdmins');
    if (!isAdmin) return { success: false, error: `User not authorized` };
  }
  return { success: true, username: input.user };
};

const serverData: McpServerData = { ..., tokenGenAuthHandler };
```

## Multi-Authentication System

### createAuthMW()

Universal middleware supporting all auth methods:

```typescript
import { createAuthMW } from 'fa-mcp-sdk';

const authMW = createAuthMW();
app.use('/api', authMW);

app.get('/api/protected', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({ authType: authInfo?.authType, username: authInfo?.username });
});

// Advanced options
const authMW = createAuthMW({
  mcpPaths: ['/mcp', '/messages', '/sse'],  // Paths with public resource access
  logConfig: true,                           // Log config on first request
});
```

### getMultiAuthError()

Programmatic auth checking:

```typescript
import { getMultiAuthError } from 'fa-mcp-sdk';

const authError = await getMultiAuthError(req);
if (authError) {
  return res.status(authError.code).send(authError.message);
}
```

### Custom Authentication

`customAuthValidator` runs **before** standard auth (`Authorization` header check).

**Execution order:**
1. `customAuthValidator` is called first
2. If `success: true` → request is allowed, standard auth is **skipped**
3. If `success: false` → falls through to standard auth (`permanentServerTokens` / `basic` / `jwtToken`)
4. If standard auth also fails → 401

This allows using service-specific credentials (e.g. `x-api-key`, `x-service-token`) as an alternative
to the MCP `Authorization` header, without disabling standard auth entirely.

```typescript
import { CustomAuthValidator, AuthResult } from 'fa-mcp-sdk';

// Example: bypass MCP auth if service-specific header is present
const customValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && await validateApiKey(apiKey)) {
    return { success: true, authType: 'custom', username: 'api-user' };
  }
  // Return false → falls through to standard Authorization header check
  return { success: false, error: 'No valid API key' };
};

const serverData: McpServerData = { ..., customAuthValidator: customValidator };
```

**Example: allow requests with upstream service headers to bypass MCP auth**

```typescript
// Clients that pass x-service-token OR x-username+x-password are allowed in
// without an MCP Authorization token. Clients without these headers still
// need a valid Authorization header (permanentToken / basic / JWT).
const serviceHeadersValidator: CustomAuthValidator = (req) => {
  const h = req.headers as Record<string, string>;
  if (h['x-service-token'] || (h['x-username'] && h['x-password'])) {
    return { success: true, authType: 'custom' };
  }
  return { success: false, error: 'No service credentials and no MCP Authorization token' };
};
```

> **Note:** `customAuthValidator` receives a request with **normalized** (lowercased) header names.
> `authInfo` is **not** set on `req` when the validator runs — it is set by the middleware only after
> successful authentication completes.

## Agent Tester Authentication

Protect the Agent Tester (`/agent-tester/*`) with `agentTester.useAuth`:

```yaml
agentTester:
  useAuth: true   # Require authentication for Agent Tester
webServer:
  auth:
    enabled: true
    permanentServerTokens: ['my-secret-token']
```

Or via ENV: `AGENT_TESTER_USE_AUTH=true`

When `useAuth` is `true`, the full multi-auth middleware is applied to Agent Tester routes — the same authentication used for MCP endpoints (`permanentServerTokens` / `basic` / `jwtToken` / `custom`). Browser users see a login dialog; headless clients pass `Authorization` header directly.

See [Agent Tester docs](08-agent-tester-and-headless-api.md#authentication-agenttesteruseauth) for details on the login flow, session management, and API endpoints.

## AD Group Checking

### Configuration

```yaml
# config/local.yaml
ad:
  domains:
    MYDOMAIN:
      default: true
      controllers: ['ldap://dc1.corp.com']
      username: 'svc_account@corp.com'
      password: '***'
```

### Usage

```typescript
import { initADGroupChecker } from 'fa-mcp-sdk';

const { isUserInGroup, groupChecker } = initADGroupChecker();

const isAdmin = await isUserInGroup('john.doe', 'Admins');
groupChecker.clearCache();  // Clear if needed
```

## JWT IP Restriction

When `webServer.auth.jwtToken.isCheckIP` is `true`, JWT tokens can include an `ip` field in their payload to restrict which client IPs may use the token.

### Configuration

```yaml
# config/default.yaml
webServer:
  auth:
    jwtToken:
      isCheckIP: true  # Enable IP checking
```

### Token Generation

When generating a token (via admin UI or `generateToken()`), include the `ip` field in the payload:

```typescript
const token = generateToken('john_doe', 3600, {
  service: 'my-mcp-server',
  ip: '192.168.1.100, 10.0.0.0/24',
});
```

The `ip` field is a string of IP addresses and/or CIDR masks, separated by commas, semicolons, or spaces.

In the admin UI (`/admin`), there is a dedicated "Allowed IP addresses" field for entering these values.

### Behavior

| `isCheckIP` | `payload.ip` | Client IP | Result |
|-------------|-------------|-----------|--------|
| `false` | any | any | IP not checked |
| `true` | empty/missing | any | IP not checked (pass-through) |
| `true` | `10.0.0.0/24` | `10.0.0.5` | Allowed |
| `true` | `10.0.0.0/24` | `192.168.1.1` | Denied |
| `true` | `192.168.1.1, 10.0.0.0/8` | `10.5.5.5` | Allowed (covered by /8) |

Supported formats: IPv4, IPv6, CIDR notation (e.g., `10.0.0.0/24`, `fe80::/10`), IPv4-mapped IPv6 (`::ffff:192.168.1.1`).

## Client Examples

```bash
# Permanent token
curl -H "Authorization: Bearer server-token-1" http://localhost:3000/mcp

# JWT
curl -H "Authorization: Bearer eyJ..." http://localhost:3000/mcp

# Basic Auth
curl -H "Authorization: Basic $(echo -n 'admin:password' | base64)" http://localhost:3000/mcp

# Custom headers
curl -H "X-API-Key: custom-key" http://localhost:3000/mcp
```

## CLI Token Generator

Generate JWT tokens from the command line without starting the server:

```bash
node scripts/generate-jwt.js -u <username> -ttl <duration> [-s <service>] [-p <params>]
```

| Option | ENV | Description |
|--------|-----|-------------|
| `-u`, `--username` | `JWT_PAYLOAD_USERNAME` | Username (required) |
| `-ttl` | `JWT_TTL` | Token lifetime: `<N>s` \| `<N>m` \| `<N>d` \| `<N>y` (required) |
| `-s`, `--service-name` | `JWT_PAYLOAD_SERVICE_NAME` | Service name (optional) |
| `-p`, `--params` | `JWT_PAYLOAD_PARAMS` | Extra payload `key=value;key=value` (optional) |

The `encryptKey` is read from config `webServer.auth.jwtToken.encryptKey` (via `config/local.yaml` or ENV `WS_TOKEN_ENCRYPT_KEY`).

**Examples:**

```bash
# 30-day token with service name
node scripts/generate-jwt.js -u admin -ttl 30d -s my-mcp-server

# 1-year token with extra payload fields
node scripts/generate-jwt.js -u svc-account -ttl 1y -p "role=admin;team=backend"

# Via environment variables
JWT_PAYLOAD_USERNAME=admin JWT_TTL=8d node scripts/generate-jwt.js
```

## Token Generator App

```typescript
import { generateTokenApp } from 'fa-mcp-sdk';

generateTokenApp();      // Port 3030
generateTokenApp(1234);  // Custom port
```

**Endpoints:**
- `/` - Web UI
- `/admin/api/generate-token` - POST: Generate token
- `/admin/api/validate-token` - POST: Validate token
- `/admin/api/service-info` - GET: Service info
- `/admin/api/auth-status` - GET: Auth status
