export type { AppConfig } from './_types_/config.js';
export type { IADConfig, IDcConfig } from './_types_/active-directory-config.js';
export type {
  McpServerData,
  IToolHandlerParams,
  ITransportContext,
  TTransportType,
  IGetPromptParams,
  IGetPromptRequest,
  IPromptContent,
  IPromptData,
  TPromptContentFunction,

  IResource,
  TResourceContentFunction,
  IResourceContent,
  IReadResourceRequest,
  IResourceInfo,
  IResourceData,

  IEndpointsOn404,
  IUsedHttpHeader,

  IToolProperties,
  IToolInputSchema,
  CustomAuthValidator,
  TokenGenAuthHandler,
  TokenGenAuthInput,
} from './_types_/types.js';

export { appConfig, getProjectData, getSafeAppConfig } from './bootstrap/init-config.js';

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

export {
  addErrorMessage,
  createJsonRpcErrorResponse,
  toError,
  toStr,
  ToolExecutionError,
  ServerError,
} from './errors/errors.js';

export { ValidationError } from './errors/ValidationError.js';

export { generateToken } from './auth/jwt.js';

export async function generateTokenApp (...args: any[]) {
  const { generateTokenApp: generateTokenApp_ } = await import('./auth/token-generator/server.js');
  return generateTokenApp_(...args);
}

export {
  createAuthMW,          // Universal authentication middleware
  getMultiAuthError,     // Programmatic authentication checking
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

export { formatToolResult, getJsonFromResult } from './utils/formatToolResult.js';
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
export { logger, fileLogger } from './logger.js';

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
