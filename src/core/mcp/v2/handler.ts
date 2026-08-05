import { createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import chalk from 'chalk';

import { logger as lgr } from '../../logger.js';
import { v2ServerFactory } from './factory.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('mcp-v2') });

let httpHandler: McpHttpHandler | undefined;
let nodeHandler: NodeMcpRequestHandler | undefined;

/**
 * The 2026-07-28 (modern) MCP handler. Serves every non-sessionful `POST /mcp` request: modern
 * per-request-`_meta` traffic natively and sessionless legacy (`initialize`-era) traffic through
 * the v2 stateless fallback (`legacy: 'stateless'`). Header validation (`-32020` / `-32022`),
 * `_meta` validation, `resultType`, `serverInfo` and cache-hint stamping, and `server/discover`
 * are all performed by the handler itself. Sessionful legacy clients stay on the v1 transport in
 * `server-http.ts` and never reach this handler.
 */
export const getV2HttpHandler = (): McpHttpHandler => {
  httpHandler ??= createMcpHandler(v2ServerFactory, {
    legacy: 'stateless',
    onerror: (error: Error) => logger.error(`v2 MCP handler error: ${error.message}`),
  });
  return httpHandler;
};

/**
 * Node.js `(req, res, parsedBody)` adapter over {@link getV2HttpHandler}. Pass `req.body` as the
 * third argument — `express.json()` has already consumed the stream. `req.auth` (set by the auth
 * middleware) is forwarded as the handler's `authInfo` automatically.
 */
export const getV2NodeHandler = (): NodeMcpRequestHandler => {
  nodeHandler ??= toNodeHandler(getV2HttpHandler(), {
    onerror: (error: Error) => logger.error(`v2 MCP node adapter error: ${error.message}`),
  });
  return nodeHandler;
};
