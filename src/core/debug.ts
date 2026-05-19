import { bold, reset, yellow, red, magenta, cyan, lBlue, lCyan, lGreen, lYellow } from 'af-color';
import { Debug } from 'af-tools-ts';

export const debugTokenAuth = Debug('token:auth', {
  noTime: false,
  noPrefix: false,
  prefixColor: bold + yellow,
  messageColor: reset,
});

/**
 * Tool call request (name + arguments) and response (the value returned to the MCP client).
 * Enable: DEBUG=mcp:tool
 */
export const debugMcpTool = Debug('mcp:tool', {
  noTime: false,
  noPrefix: false,
  prefixColor: red,
  messageColor: lBlue,
});

/**
 * Resource list and read — request URI and response payload.
 * Enable: DEBUG=mcp:resource
 */
export const debugMcpResource = Debug('mcp:resource', {
  noTime: false,
  noPrefix: false,
  prefixColor: magenta,
  messageColor: lCyan,
});

/**
 * Prompt list and get — request name/args and response messages.
 * Enable: DEBUG=mcp:prompt
 */
export const debugMcpPrompt = Debug('mcp:prompt', {
  noTime: false,
  noPrefix: false,
  prefixColor: yellow,
  messageColor: lGreen,
});

/**
 * Incoming MCP JSON-RPC notifications (method + params).
 * Enable: DEBUG=mcp:notification
 */
export const debugMcpNotification = Debug('mcp:notification', {
  noTime: false,
  noPrefix: false,
  prefixColor: cyan,
  messageColor: lYellow,
});

// Enable all of the above at once with DEBUG=mcp:*

// agent
// config-info
// dialog-metrics-collector
// fetch
// log-event
// pipeline
// query-builder
// queue:testing
// rag
// report
// rest-api
// sql
// sql:count
// testing
// token:auth
// user
// web:all
// web:headers
// web:health

// ntlm:auth-flow
// ntlm:ldap-proxy
// ntlm:ldap-proxy-id
// ntlm:context
