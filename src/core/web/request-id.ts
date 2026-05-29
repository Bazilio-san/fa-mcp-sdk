import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Standard §15.1 — sticky correlation id for every request, plus optional W3C
 * trace context. The middleware stores them in {@link AsyncLocalStorage} so the
 * rest of the call chain (logger, JSON-RPC error serializer, debug-trace) can
 * pick them up without explicit plumbing.
 */
export interface ITraceContext {
  /** 32 hex chars (W3C trace-id). */
  traceId: string;
  /** 16 hex chars (W3C parent-id / span-id of the incoming span). */
  parentId: string;
  /** 2 hex chars (W3C trace flags). */
  flags: string;
}

export interface IRequestContext {
  /** Sticky id propagated end-to-end (HTTP `X-Request-Id` or stdio-generated). */
  requestId: string;
  /** Echoed verbatim to downstream services in `tracestate` (W3C). */
  tracestate?: string;
  /** Populated only when a valid W3C `traceparent` header was supplied. */
  traceContext?: ITraceContext;
  /** JSON-RPC id of the incoming message (stdio path) — never the same as `requestId`. */
  jsonRpcId?: string | number | null;
}

const requestIdStorage = new AsyncLocalStorage<IRequestContext>();

const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{8,128}$/;
const TRACEPARENT_REGEX = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/;
const TRACESTATE_MAX_LEN = 4096;

function sanitizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return REQUEST_ID_REGEX.test(trimmed) ? trimmed : undefined;
}

function parseTraceparent(value: unknown): ITraceContext | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = TRACEPARENT_REGEX.exec(value.trim().toLowerCase());
  if (!match) {
    return undefined;
  }
  const [, traceId, parentId, flags] = match;
  if (!traceId || !parentId || !flags || /^0+$/.test(traceId) || /^0+$/.test(parentId)) {
    return undefined;
  }
  return { traceId, parentId, flags };
}

function sanitizeTracestate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TRACESTATE_MAX_LEN) {
    return undefined;
  }
  return trimmed;
}

/**
 * Express middleware that materialises {@link IRequestContext} for the lifetime
 * of a request. Always sets the `X-Request-Id` response header (BEHAVIOUR
 * change introduced in 0.8.0) and echoes a valid `tracestate` back unchanged.
 */
export function requestIdMW(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = sanitizeRequestId(req.headers['x-request-id']) ?? randomUUID();
    const traceContext = parseTraceparent(req.headers['traceparent']);
    const tracestate = sanitizeTracestate(req.headers['tracestate']);

    const ctx: IRequestContext = { requestId };
    if (traceContext) {
      ctx.traceContext = traceContext;
    }
    if (tracestate) {
      ctx.tracestate = tracestate;
    }

    res.setHeader('X-Request-Id', requestId);
    if (tracestate) {
      res.setHeader('tracestate', tracestate);
    }

    requestIdStorage.run(ctx, () => next());
  };
}

/**
 * Run a callback with an explicit request context. Used by the stdio bootstrap
 * to wrap every incoming JSON-RPC message.
 */
export function runWithRequestContext<T>(ctx: IRequestContext, fn: () => T): T {
  return requestIdStorage.run(ctx, fn);
}

export function getCurrentRequestContext(): IRequestContext | undefined {
  return requestIdStorage.getStore();
}

export function getCurrentRequestId(): string | undefined {
  return requestIdStorage.getStore()?.requestId;
}

export function getCurrentJsonRpcId(): string | number | null | undefined {
  return requestIdStorage.getStore()?.jsonRpcId;
}

export function getCurrentTraceContext(): ITraceContext | undefined {
  return requestIdStorage.getStore()?.traceContext;
}

export { requestIdStorage };
