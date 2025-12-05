export type { AppConfig } from './_types_/config.js';
export type { IADConfig, IDcConfig } from './_types_/active-directory-config.js';
export type {
  McpServerData,
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
  ISwaggerData,
  IRequiredHttpHeader,

  IToolProperties,
  IToolInputSchema,
} from './_types_/types.js';

export { appConfig } from './bootstrap/init-config.js';

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

export type { ICheckTokenResult } from './token/i-token.js';
export {
  authByToken,
  authTokenMW,
} from './token/token-auth.js';

export async function generateTokenApp (...args: any[]) {
  const { generateTokenApp: generateTokenApp_ } = await import('./token/gen-token-app/gen-token-server.js');
  return generateTokenApp_(...args);
}

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
} from './utils/utils.js';
export { isPortAvailable, checkPortAvailability } from './utils/port-checker.js';

export { ROOT_PROJECT_DIR } from './constants.js';
export { eventEmitter } from './ee.js';
export { logger, fileLogger } from './logger.js';

export { McpHttpClient } from './utils/testing/McpHttpClient.js';
export { McpSseClient } from './utils/testing/McpSseClient.js';
export { McpStdioClient } from './utils/testing/McpStdioClient.js';
export { McpStreamableHttpClient } from './utils/testing/McpStreamableHttpClient.js';
