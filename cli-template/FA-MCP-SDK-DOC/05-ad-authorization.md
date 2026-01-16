# Advanced AD Group Authorization

This document demonstrates how to implement additional authorization based on Active Directory (AD)
group membership. These examples assume JWT token authentication (`jwtToken`) is configured,
and the user information is extracted from the JWT payload.

## AD Configuration Types

### `IADConfig`

Main Active Directory configuration interface for group membership checks and NTLM authentication.

```typescript
import { IADConfig } from 'fa-mcp-sdk';

// Type Definition:
interface IADConfig {
  ad: {
    domains: {
      // Key is domain name (e.g., 'OFFICE', 'CORP')
      [domainName: string]: IDcConfig;
    };
    tlsOptions?: ConnectionOptions;  // TLS options for LDAPS connections
    strategy?: EAuthStrategy;        // NTLM authentication strategy
    groupCacheTtlMs?: number;        // Cache TTL for group checks (default: 10 minutes)
    dnCacheTtlMs?: number;           // Cache TTL for DN lookups (default: 24 hours)
  };
}
```

### `IDcConfig`

Domain Controller configuration for individual AD domains.

```typescript
import { IDcConfig } from 'fa-mcp-sdk';

// Type Definition:
interface IDcConfig {
  controllers: string[];     // LDAP URLs: ['ldap://dc1.corp.com', 'ldap://dc2.corp.com']
  username: string;          // Service account for LDAP queries
  password: string;          // Service account password
  baseDn?: string;           // Base DN for searches (auto-derived from URL if not set)
  default?: boolean;         // Mark as default domain for operations

  // Internal fields (assigned during config processing):
  name?: string;             // Domain name
  hostReSource?: string;     // RegExp source for hostname matching
  hostRe?: RegExp;           // Compiled hostname matcher
}
```

**Configuration Example (`config/default.yaml`):**

```yaml
ad:
  groupCacheTtlMs: 600000    # 10 minutes
  dnCacheTtlMs: 86400000     # 24 hours
  domains:
    CORP:
      default: true
      controllers:
        - 'ldap://dc1.corp.com'
        - 'ldap://dc2.corp.com'
      username: 'svc_mcp@corp.com'
      password: '${AD_SERVICE_PASSWORD}'  # From environment variable
      baseDn: 'DC=corp,DC=com'            # Optional, auto-derived if omitted
    PARTNER:
      controllers:
        - 'ldap://dc1.partner.local'
      username: 'svc_reader@partner.local'
      password: '${AD_PARTNER_PASSWORD}'
```

---

## Configuration for AD Group Authorization

First, extend your configuration to include the required AD group:

**`src/_types_/custom-config.ts`:**
```typescript
import { AppConfig } from 'fa-mcp-sdk';

export interface IGroupAccessConfig {
  groupAccess: {
    /** AD group required for access */
    requiredGroup: string;
    /** Bypass group check for debugging (default: false) */
    bypassGroupCheck?: boolean;
    /** Cache TTL in seconds (default: 300) */
    cacheTtlSeconds?: number;
  };
}

export interface CustomAppConfig extends AppConfig, IGroupAccessConfig {}
```

**`config/default.yaml`:**
```yaml
groupAccess:
  requiredGroup: "DOMAIN\\MCP-Users"
  bypassGroupCheck: false
  cacheTtlSeconds: 300
```

---

## Example 1: HTTP Server Level Access Restriction

This example uses `customAuthValidator` to check AD group membership at the HTTP server level.
If the user is not in the required group, a 403 Forbidden error is returned before any
MCP request processing.

**`src/start.ts`:**
```typescript
import {
  appConfig,
  initMcpServer,
  McpServerData,
  CustomAuthValidator,
  AuthResult,
  initADGroupChecker,
} from 'fa-mcp-sdk';
// Note: JWT validation is handled automatically by the SDK's multi-auth system.
// The customAuthValidator receives parsed JWT payload when jwtToken auth is enabled.
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';
import { AGENT_BRIEF } from './prompts/agent-brief.js';
import { AGENT_PROMPT } from './prompts/agent-prompt.js';
import { CustomAppConfig } from './_types_/custom-config.js';

// Get typed config
const config = appConfig as CustomAppConfig;

// Initialize AD group checker
const { isUserInGroup } = initADGroupChecker();

/**
 * Custom authentication validator with AD group membership check
 * This validator is called AFTER the SDK's standard JWT validation.
 * The req object contains parsed authInfo from the standard auth flow.
 * Returns 403 Forbidden if user is not in the required AD group
 */
const customAuthValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  // Extract user info from request (populated by standard auth)
  const authInfo = (req as any).authInfo;

  // If standard auth failed or no user info, let standard auth handle it
  if (!authInfo?.username) {
    return { success: false, error: 'User information not available' };
  }

  const username = authInfo.username;

  // Bypass group check if configured (for debugging)
  if (config.groupAccess.bypassGroupCheck) {
    return {
      success: true,
      authType: authInfo.authType,
      username,
      payload: authInfo.payload,
    };
  }

  // Check AD group membership
  const requiredGroup = config.groupAccess.requiredGroup;
  try {
    const isInGroup = await isUserInGroup(username, requiredGroup);

    if (!isInGroup) {
      return {
        success: false,
        error: `Forbidden: User '${username}' is not a member of group '${requiredGroup}'`,
      };
    }

    return {
      success: true,
      authType: authInfo.authType,
      username,
      payload: authInfo.payload,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `AD group check failed: ${errorMessage}`,
    };
  }
};

const startProject = async (): Promise<void> => {
  const serverData: McpServerData = {
    tools,
    toolHandler: handleToolCall,
    agentBrief: AGENT_BRIEF,
    agentPrompt: AGENT_PROMPT,

    // Enable custom authentication with AD group check
    customAuthValidator,

    // ... other configuration
  };

  await initMcpServer(serverData);
};

startProject().catch(console.error);
```

**Result**: If the user is not in the required AD group, they receive HTTP 403 Forbidden
response before any MCP processing occurs.

---

## Example 2: Access Restriction to ALL MCP Tools

This example restricts access to all MCP tools by checking AD group membership in the
`toolHandler` function. If the user is not in the required group, the tool call returns
an MCP error with "Forbidden" message.

**`src/tools/handle-tool-call.ts`:**
```typescript
import {
  formatToolResult,
  ToolExecutionError,
  logger,
  appConfig,
  initADGroupChecker,
  IToolHandlerParams,
} from 'fa-mcp-sdk';
import { CustomAppConfig } from '../_types_/custom-config.js';

// Get typed config
const config = appConfig as CustomAppConfig;

// Initialize AD group checker
const { isUserInGroup } = initADGroupChecker();

/**
 * Check if user has access to MCP tools based on AD group membership
 */
async function checkToolAccess(payload: IToolHandlerParams['payload']): Promise<void> {
  // Skip check if bypass is enabled
  if (config.groupAccess.bypassGroupCheck) {
    return;
  }

  if (!payload?.user) {
    throw new ToolExecutionError('authorization', 'Forbidden: User information not available');
  }

  const username = payload.user;
  const requiredGroup = config.groupAccess.requiredGroup;

  try {
    const isInGroup = await isUserInGroup(username, requiredGroup);

    if (!isInGroup) {
      throw new ToolExecutionError(
        'authorization',
        `Forbidden: User '${username}' is not authorized to use MCP tools. ` +
        `Required group: '${requiredGroup}'`
      );
    }
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ToolExecutionError('authorization', `Forbidden: AD group check failed - ${errorMessage}`);
  }
}

export const handleToolCall = async (params: IToolHandlerParams): Promise<any> => {
  const { name, arguments: args, headers, payload } = params;

  logger.info(`Tool called: ${name} by user: ${payload?.user || 'unknown'}`);

  // Check AD group membership for ALL tools
  await checkToolAccess(payload);

  try {
    switch (name) {
      case 'my_tool':
        return await handleMyTool(args);
      case 'another_tool':
        return await handleAnotherTool(args);
      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool execution failed for ${name}:`, error);
    throw error;
  }
};

async function handleMyTool(args: any): Promise<any> {
  // Tool implementation
  return formatToolResult({ message: 'Tool executed successfully', args });
}

async function handleAnotherTool(args: any): Promise<any> {
  // Tool implementation
  return formatToolResult({ message: 'Another tool executed', args });
}
```

**Result**: If the user is not in the required AD group, any tool call returns an MCP error:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Forbidden: User 'john.doe' is not authorized to use MCP tools. Required group: 'DOMAIN\\MCP-Users'"
  },
  "id": 1
}
```

---

## Example 3: Access Restriction to a SPECIFIC MCP Tool

This example restricts access to specific MCP tools based on AD group membership.
Different tools can require different AD groups.

**`src/_types_/custom-config.ts`:**
```typescript
import { AppConfig } from 'fa-mcp-sdk';

export interface IToolGroupAccessConfig {
  toolGroupAccess: {
    /** Default group required for tools without specific configuration */
    defaultGroup?: string;
    /** Specific group requirements per tool */
    tools: Record<string, {
      /** AD group required for this tool */
      requiredGroup: string;
      /** Allow access without group check (default: false) */
      public?: boolean;
    }>;
    /** Bypass all group checks (for debugging) */
    bypassGroupCheck?: boolean;
  };
}

export interface CustomAppConfig extends AppConfig, IToolGroupAccessConfig {}
```

**`config/default.yaml`:**
```yaml
toolGroupAccess:
  defaultGroup: "DOMAIN\\MCP-Users"
  bypassGroupCheck: false
  tools:
    get_public_data:
      public: true  # No group check required
    get_user_data:
      requiredGroup: "DOMAIN\\MCP-Users"
    modify_data:
      requiredGroup: "DOMAIN\\MCP-DataModifiers"
    admin_operation:
      requiredGroup: "DOMAIN\\MCP-Admins"
```

**`src/tools/handle-tool-call.ts`:**
```typescript
import {
  formatToolResult,
  ToolExecutionError,
  logger,
  appConfig,
  initADGroupChecker,
  IToolHandlerParams,
} from 'fa-mcp-sdk';
import { CustomAppConfig } from '../_types_/custom-config.js';

// Get typed config
const config = appConfig as CustomAppConfig;

// Initialize AD group checker
const { isUserInGroup } = initADGroupChecker();

/**
 * Check if user has access to a specific tool based on AD group membership
 */
async function checkToolAccess(
  toolName: string,
  payload: IToolHandlerParams['payload']
): Promise<void> {
  const toolAccess = config.toolGroupAccess;

  // Skip check if bypass is enabled
  if (toolAccess.bypassGroupCheck) {
    return;
  }

  const toolConfig = toolAccess.tools[toolName];

  // If tool is marked as public, allow access
  if (toolConfig?.public) {
    return;
  }

  // Check user availability
  if (!payload?.user) {
    throw new ToolExecutionError(
      toolName,
      `Forbidden: User information not available for tool '${toolName}'`
    );
  }

  const username = payload.user;

  // Determine required group: tool-specific or default
  const requiredGroup = toolConfig?.requiredGroup || toolAccess.defaultGroup;

  if (!requiredGroup) {
    // No group configured - allow access
    return;
  }

  try {
    const isInGroup = await isUserInGroup(username, requiredGroup);

    if (!isInGroup) {
      throw new ToolExecutionError(
        toolName,
        `Forbidden: User '${username}' is not authorized to use tool '${toolName}'. ` +
        `Required group: '${requiredGroup}'`
      );
    }

    logger.info(`User '${username}' authorized for tool '${toolName}' via group '${requiredGroup}'`);
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ToolExecutionError(
      toolName,
      `Forbidden: AD group check failed for tool '${toolName}' - ${errorMessage}`
    );
  }
}

export const handleToolCall = async (params: IToolHandlerParams): Promise<any> => {
  const { name, arguments: args, headers, payload } = params;

  logger.info(`Tool called: ${name} by user: ${payload?.user || 'unknown'}`);

  // Check AD group membership for the specific tool
  await checkToolAccess(name, payload);

  try {
    switch (name) {
      case 'get_public_data':
        // Public tool - no group check was performed
        return await handleGetPublicData(args);

      case 'get_user_data':
        // Requires MCP-Users group
        return await handleGetUserData(args);

      case 'modify_data':
        // Requires MCP-DataModifiers group
        return await handleModifyData(args);

      case 'admin_operation':
        // Requires MCP-Admins group
        return await handleAdminOperation(args);

      default:
        // Unknown tools use defaultGroup if configured
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool execution failed for ${name}:`, error);
    throw error;
  }
};

async function handleGetPublicData(args: any): Promise<any> {
  return formatToolResult({ message: 'Public data retrieved', data: { public: true } });
}

async function handleGetUserData(args: any): Promise<any> {
  return formatToolResult({ message: 'User data retrieved', data: args });
}

async function handleModifyData(args: any): Promise<any> {
  return formatToolResult({ message: 'Data modified', modified: args });
}

async function handleAdminOperation(args: any): Promise<any> {
  return formatToolResult({ message: 'Admin operation completed', operation: args });
}
```

**Result**: Each tool enforces its own AD group requirements:
- `get_public_data` - accessible to everyone (public)
- `get_user_data` - requires `DOMAIN\MCP-Users` group
- `modify_data` - requires `DOMAIN\MCP-DataModifiers` group
- `admin_operation` - requires `DOMAIN\MCP-Admins` group

If a user tries to call a tool without being in the required group:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Forbidden: User 'john.doe' is not authorized to use tool 'admin_operation'. Required group: 'DOMAIN\\MCP-Admins'"
  },
  "id": 1
}
```

---

## Summary: Authorization Levels

| Level | Location | Error Type | Use Case |
|-------|----------|------------|----------|
| HTTP Server | `customAuthValidator` | HTTP 403 Forbidden | Block unauthorized users completely |
| All Tools | `toolHandler` (global check) | MCP Tool Error | Allow HTTP access, restrict all tool usage |
| Specific Tool | `toolHandler` (per-tool check) | MCP Tool Error | Fine-grained tool-level permissions |
