import { InMemoryServerEventBus, createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler, ServerNotifier } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import chalk from 'chalk';

import { logger as lgr } from '../../logger.js';
import { createV2ServerFactory } from './factory.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('mcp-v2') });

/** Standard `subscriptions/listen` limits: max concurrent streams per process / keep-alive comment interval. */
const MAX_SUBSCRIPTIONS = 256;
const KEEP_ALIVE_MS = 25_000;

let httpHandler: McpHttpHandler | undefined;
let nodeHandler: NodeMcpRequestHandler | undefined;

/**
 * The 2026-07-28 (modern) MCP handler. Serves every non-sessionful `POST /mcp` request: modern
 * per-request-`_meta` traffic natively and sessionless legacy (`initialize`-era) traffic through
 * the v2 stateless fallback (`legacy: 'stateless'`). Header validation (`-32020` / `-32022`),
 * `_meta` validation, `resultType`, `serverInfo` and cache-hint stamping, `server/discover`, and
 * the `subscriptions/listen` streams (ack, `subscriptionId` correlation, keep-alives) are all
 * performed by the handler itself. Sessionful legacy clients stay on the v1 transport in
 * `server-http.ts` and never reach this handler.
 */
export const getV2HttpHandler = (): McpHttpHandler => {
  httpHandler ??= createMcpHandler(createV2ServerFactory('http'), {
    legacy: 'stateless',
    bus: new InMemoryServerEventBus((error: Error) => logger.error(`v2 event bus listener error: ${error.message}`)),
    maxSubscriptions: MAX_SUBSCRIPTIONS,
    keepAliveMs: KEEP_ALIVE_MS,
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

/**
 * Change-notification publisher for the modern era (`subscriptions/listen`, 2026-07-28). Each
 * method fans the corresponding notification out to every open listen-subscription that opted in:
 * `resourceUpdated(uri)` → `notifications/resources/updated`, `toolsChanged()` →
 * `notifications/tools/list_changed`, etc. Complements the legacy per-session
 * `notifyResourceUpdated(server, uri)` (which also calls into this publisher, so project code
 * written for the legacy API reaches modern subscribers too).
 */
export const mcpNotify: ServerNotifier = {
  toolsChanged: () => getV2HttpHandler().notify.toolsChanged(),
  promptsChanged: () => getV2HttpHandler().notify.promptsChanged(),
  resourcesChanged: () => getV2HttpHandler().notify.resourcesChanged(),
  resourceUpdated: (uri: string) => getV2HttpHandler().notify.resourceUpdated(uri),
};
