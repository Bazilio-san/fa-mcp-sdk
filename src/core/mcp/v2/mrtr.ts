import { randomBytes } from 'node:crypto';

import { createRequestStateCodec } from '@modelcontextprotocol/server';
import type { RequestStateCodec } from '@modelcontextprotocol/server';
import chalk from 'chalk';

import { IClientCapabilities, IInputRequiredResponse } from '../../_types_/types.js';
import { appConfig } from '../../bootstrap/init-config.js';
import { logger as lgr } from '../../logger.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('mcp-mrtr') });

/**
 * MRTR (2026-07-28) plumbing: the `requestState` integrity codec and the public
 * `formatInputRequired` helper for tool authors. The codec is the v2 package's
 * `createRequestStateCodec` — HMAC-SHA256, TTL, and a principal+method binding tag, satisfying
 * the spec's integrity/replay MUSTs; verification runs in `ServerOptions.requestState.verify`
 * before the handler is entered, so a tampered/expired/foreign blob never reaches tool code.
 */

/** Marker returned by a tool handler to pause the call and request client input. */
export const formatInputRequired = (spec: Omit<IInputRequiredResponse, '__inputRequired'>): IInputRequiredResponse => {
  if (!spec.inputRequests && spec.state === undefined) {
    throw new TypeError('formatInputRequired() requires at least one of inputRequests / state');
  }
  return { __inputRequired: true, ...spec };
};

export const isInputRequiredResponse = (value: unknown): value is IInputRequiredResponse =>
  Boolean(value) && typeof value === 'object' && (value as IInputRequiredResponse).__inputRequired === true;

/** Client capability required for each embedded input-request method (spec: server MUST NOT send undeclared kinds). */
const REQUIRED_CAPABILITY: Record<string, keyof IClientCapabilities | 'roots'> = {
  'elicitation/create': 'elicitation',
  'sampling/createMessage': 'sampling',
  'roots/list': 'roots',
};

/**
 * The client capabilities missing for the given `inputRequests` (empty array = all declared).
 * The v2 wrapper turns a non-empty result into an actionable `isError: true` text instead of
 * sending requests the client cannot fulfil.
 */
export const missingCapabilitiesForInputRequests = (
  inputRequests: IInputRequiredResponse['inputRequests'],
  caps: IClientCapabilities | undefined,
): string[] => {
  const missing = new Set<string>();
  for (const request of Object.values(inputRequests ?? {})) {
    const needed = REQUIRED_CAPABILITY[request.method];
    if (needed && !(caps as Record<string, unknown> | undefined)?.[needed]) {
      missing.add(needed);
    }
  }
  return [...missing];
};

let codec: RequestStateCodec | undefined;

/**
 * Process-wide `requestState` codec. Key: `mcp.mrtr.stateSecret` (min 32 chars); empty → a random
 * per-process key (single-instance deployments only — a restart invalidates in-flight MRTR
 * cycles, and multiple instances cannot verify each other's blobs). Binding ties the blob to the
 * originating method and the authenticated principal, per the spec's replay-protection SHOULDs.
 */
export const getRequestStateCodec = (): RequestStateCodec => {
  if (!codec) {
    const configured = appConfig.mcp.mrtr?.stateSecret?.trim();
    let key: string | Uint8Array;
    if (configured && configured.length >= 32) {
      key = configured;
    } else {
      if (configured) {
        logger.warn('mcp.mrtr.stateSecret is shorter than 32 characters — falling back to a random per-process key');
      }
      key = randomBytes(32);
    }
    codec = createRequestStateCodec({
      key,
      ttlSeconds: appConfig.mcp.mrtr?.stateTtlSeconds ?? 600,
      bind: (ctx) => {
        const payload = (ctx as { http?: { authInfo?: { payload?: Record<string, unknown> } } }).http?.authInfo
          ?.payload;
        const principal = String(payload?.sub ?? payload?.user ?? '');
        return `${(ctx as { mcpReq?: { method?: string } }).mcpReq?.method ?? ''}\0${principal}`;
      },
    });
  }
  return codec;
};
