// noinspection UnnecessaryLocalVariableJS

/**
 * Example: Custom Basic Authentication Implementation
 *
 * This example shows how to implement custom basic authentication
 * validation with fa-mcp-sdk multi-authentication system.
 */

import { McpServerData, CustomBasicAuthValidator, initMcpServer } from 'fa-mcp-sdk';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ========================================================================
// EXAMPLE 1: Database-backed Authentication
// ========================================================================

/**
 * Custom validator using database lookup
 */
const databaseBasicAuthValidator: CustomBasicAuthValidator = async (username: string, password: string): Promise<boolean> => {
  // Example: Check credentials against a database
  try {
    // This would be your actual database query
    const user = await getUserFromDatabase(username);

    if (!user) {
      return false;
    }

    // Example: Compare hashed password
    const isValidPassword = await comparePassword(password, user.hashedPassword);
    return isValidPassword;

  } catch (error) {
    console.error('Database authentication error:', error);
    return false;
  }
};

// ========================================================================
// EXAMPLE 2: LDAP/Active Directory Authentication
// ========================================================================

/**
 * Custom validator using LDAP/AD
 */
const ldapBasicAuthValidator: CustomBasicAuthValidator = async (username: string, password: string): Promise<boolean> => {
  try {
    // Example LDAP authentication
    const ldapResult = await authenticateWithLDAP(username, password);
    return ldapResult.success;

  } catch (error) {
    console.error('LDAP authentication error:', error);
    return false;
  }
};

// ========================================================================
// EXAMPLE 3: External API Authentication
// ========================================================================

/**
 * Custom validator using external authentication service
 */
const externalApiAuthValidator: CustomBasicAuthValidator = async (username: string, password: string): Promise<boolean> => {
  try {
    const response = await fetch('https://auth.example.com/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      return false;
    }

    const result: any = await response.json();
    return result.valid === true;

  } catch (error) {
    console.error('External API authentication error:', error);
    return false;
  }
};

// ========================================================================
// EXAMPLE 4: Multi-factor Authentication
// ========================================================================

/**
 * Custom validator with multi-factor authentication
 */
const mfaBasicAuthValidator: CustomBasicAuthValidator = async (username: string, password: string): Promise<boolean> => {
  try {
    // Password format: "actualPassword:mfaToken"
    const [actualPassword, mfaToken] = password.split(':');

    if (!actualPassword || !mfaToken) {
      return false;
    }

    // Validate base credentials
    const user = await getUserFromDatabase(username);
    if (!user || !(await comparePassword(actualPassword, user.hashedPassword))) {
      return false;
    }

    // Validate MFA token
    const mfaValid = await validateMFAToken(username, mfaToken);
    return mfaValid;

  } catch (error) {
    console.error('MFA authentication error:', error);
    return false;
  }
};

// ========================================================================
// MCP SERVER INITIALIZATION WITH CUSTOM AUTH
// ========================================================================

const tools: Tool[] = [
  {
    name: 'example-tool',
    description: 'An example tool',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  },
];

const toolHandler = async (params: { name: string; arguments?: any }) => {
  return { content: [{ type: 'text', text: `Tool ${params.name} executed` }] };
};

const mcpServerData: McpServerData = {
  tools,
  toolHandler,
  agentBrief: 'Example MCP Server with Custom Basic Auth',
  agentPrompt: 'This server demonstrates custom basic authentication.',

  // Custom basic auth validator
// @ts-ignore
  customBasicAuthValidator: databaseBasicAuthValidator, // or any of the other validators
};

// ========================================================================
// MOCK FUNCTIONS (Replace with your actual implementations)
// ========================================================================

async function getUserFromDatabase (username: string): Promise<{ hashedPassword: string } | null> {
  // Mock implementation - replace with your database query
  const mockUsers = {
    'admin': { hashedPassword: 'hashed_admin_password' },
    'user': { hashedPassword: 'hashed_user_password' },
  };
  return mockUsers[username as keyof typeof mockUsers] || null;
}

async function comparePassword (plaintext: string, hashed: string): Promise<boolean> {
  // Mock implementation - replace with proper password hashing library (e.g., bcrypt)
  return `hashed_${plaintext}_password` === hashed;
}

async function authenticateWithLDAP (username: string, password: string): Promise<{ success: boolean }> {
  // Mock implementation - replace with actual LDAP client
  return { success: username === 'ldapuser' && password === 'ldappassword' };
}

async function validateMFAToken (username: string, token: string): Promise<boolean> {
  // Mock implementation - replace with actual MFA validation
  return token === '123456'; // Mock 6-digit MFA token
}

// ========================================================================
// START THE SERVER
// ========================================================================

// Initialize and start the MCP server with custom basic authentication
initMcpServer(mcpServerData).catch(console.error);

// ========================================================================
// CONFIGURATION EXAMPLE (config/default.yaml)
// ========================================================================

/*
webServer:
  auth:
    enabled: true
    basic:
      type: 'basic'
      # When using custom validator, username/password can be anything or even omitted
      # The custom validator function will handle the actual authentication
      username: 'placeholder'
      password: 'placeholder'
    # Other auth types can be configured alongside custom basic auth
    jwtToken:
      encryptKey: 'your-secret-key'
      checkMCPName: true
    permanentServerTokens:
      - 'server-token-1'
      - 'server-token-2'
*/

// ========================================================================
// USAGE EXAMPLES
// ========================================================================

/*
1. Using curl with custom basic auth:

curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'admin:adminpassword' | base64)" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

2. With MFA (if using mfaBasicAuthValidator):

curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'admin:adminpassword:123456' | base64)" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

3. JavaScript client example:

const credentials = btoa('admin:adminpassword');
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${credentials}`
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  })
});
*/

export {
  databaseBasicAuthValidator,
  ldapBasicAuthValidator,
  externalApiAuthValidator,
  mfaBasicAuthValidator,
};
