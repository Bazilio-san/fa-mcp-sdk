export type { Tool } from '@modelcontextprotocol/sdk/types.js';
export type { AppConfig } from './_types_/config.js';
export type { IADConfig, IDcConfig } from './_types_/active-directory-config.js';
export type {
  IClientCapabilities,
  McpServerData,
  IToolHandlerParams,
  ITransportContext,
  TTransportType,
  IGetPromptParams,
  IGetPromptRequest,
  IPromptArgument,
  IPromptContent,
  IPromptData,
  TPromptContentFunction,
  IResource,
  TResourceContentFunction,
  TResourceBinaryContentFunction,
  IResourceBinaryContent,
  IResourceContent,
  IReadResourceRequest,
  IResourceInfo,
  IResourceData,
  IResourceTemplateInfo,
  IUiResourceMeta,
  IEndpointsOn404,
  IUsedHttpHeader,
  IToolProperties,
  IToolInputSchema,
  CustomAuthValidator,
  TokenGenAuthHandler,
  TokenGenAuthInput,
  TToolHandlerResponse,
  IToolHandlerTextResponse,
  IToolHandlerStructuredResponse,
} from './_types_/types.js';

export { appConfig, getProjectData, getSafeAppConfig } from './bootstrap/init-config.js';

export {
  getUiCapability,
  hostSupportsMcpApps,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_RESOURCE_MIME_TYPE,
} from './mcp/mcp-apps.js';
export type { IMcpUiClientCapabilities } from './mcp/mcp-apps.js';

export { accessPointUpdater } from './consul/access-points-updater.js';
export { deregisterServiceFromConsul } from './consul/deregister.js';
export { getConsulAPI } from './consul/get-consul-api.js';

export {
  execMAIN,
  queryRsMAIN,
  queryMAIN,
  checkMainDB,
  getInsertSqlMAIN,
  getMainDBConnectionStatus,
  getMergeSqlMAIN,
  mergeByBatch,
  oneRowMAIN,
} from './db/pg-db.js';

export type { IQueryPgArgsCOptional } from './db/pg-db.js';

export { BaseMcpError } from './errors/BaseMcpError.js';
export type { IMcpErrorData } from './errors/BaseMcpError.js';

export {
  addErrorMessage,
  createJsonRpcErrorResponse,
  sanitizeOutwardMessage,
  toError,
  toMcpError,
  toStr,
  ToolExecutionError,
  ServerError,
} from './errors/errors.js';

export {
  MCP_ERROR_CODES,
  PayloadTooLargeError,
  TimeoutError,
  RateLimitedError,
  ResourceNotFoundError,
  UpstreamUnavailableError,
  ConflictError,
} from './errors/specific-errors.js';

export { ValidationError } from './errors/ValidationError.js';

export { generateToken } from './auth/jwt.js';

export async function generateTokenApp(...args: any[]) {
  const { generateTokenApp: generateTokenApp_ } = await import('./auth/token-generator/server.js');
  return generateTokenApp_(...args);
}

export {
  createAuthMW, // Universal authentication middleware
  getMultiAuthError, // Programmatic authentication checking
} from './auth/middleware.js';

export {
  checkMultiAuth,
  detectAuthConfiguration,
  logAuthConfiguration,
  getAuthHeadersForTests,
} from './auth/multi-auth.js';

export type {
  AuthDetectionResult,
  AuthResult,
  AuthType,
  ICheckTokenResult,
  ITokenPayload,
  TTokenType,
} from './auth/types.js';

export { initMcpServer, gracefulShutdown } from './init-mcp-server.js';

export { notifyResourceUpdated } from './mcp/resources.js';

export {
  formatToolResult,
  formatToolError,
  getJsonFromResult,
  asJson,
  asJsonError,
  asTextContent,
  asTextError,
} from './utils/formatToolResult.js';
export {
  trim,
  isMainModule,
  isNonEmptyObject,
  isObject,
  ppj,
  encodeSvgForDataUri,
  getAsset,
  normalizeHeaders,
  getTools,
} from './utils/utils.js';
export { isPortAvailable, checkPortAvailability } from './utils/port-checker.js';

export { ROOT_PROJECT_DIR } from './constants.js';
export { eventEmitter } from './ee.js';
export { logger, fileLogger, applyLoggerSettings } from './logger.js';

export { getCache, CacheManager } from './cache/cache.js';

export { McpHttpClient } from './utils/testing/McpHttpClient.js';
export { McpSseClient } from './utils/testing/McpSseClient.js';
export { McpStdioClient } from './utils/testing/McpStdioClient.js';
export { McpStreamableHttpClient } from './utils/testing/McpStreamableHttpClient.js';

export { initADGroupChecker } from './ad/group-checker.js';

// OpenAPI/Swagger utilities
export {
  configureOpenAPI,
  createSwaggerUIAssetsMiddleware,
  type OpenAPISpecResponse,
  type SwaggerUIConfig,
} from './web/openapi.js';

export { debugTokenAuth, debugMcpTool, debugMcpResource, debugMcpPrompt, debugMcpNotification } from './debug.js';

export { configureDebugSink, emitTrace, initDebugTraceFromConfig } from './mcp/debug-trace.js';

export {
  BUILTIN_MCP_DEBUG_TOOLS,
  BUILTIN_MCP_DEBUG_TOOL_NAMES,
  MCP_DEBUG_LOG_TOOL_NAME,
  MCP_DEBUG_REFRESH_TOOL_NAME,
  handleBuiltinDebugTool,
  isBuiltinDebugTool,
} from './mcp/builtin-debug-tools.js';

export { DEBUG_TOOL, DEBUG_TOOL_NAME, handleDebugTool, registerDebugTool } from './utils/testing/debug-tool.js';

export { Logger } from 'af-logger-ts';

export { createAgentTesterRouter } from './agent-tester/agent-tester-router.js';
export { checkLlm } from './agent-tester/check-llm.js';
