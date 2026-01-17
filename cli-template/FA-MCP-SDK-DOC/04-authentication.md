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

```typescript
import { CustomAuthValidator, AuthResult } from 'fa-mcp-sdk';

const customValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  const apiKey = req.headers['x-api-key'];
  const valid = await validateApiKey(apiKey);

  if (valid) return { success: true, authType: 'custom', username: 'api-user' };
  return { success: false, error: 'Invalid API key' };
};

const serverData: McpServerData = { ..., customAuthValidator: customValidator };
```

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
