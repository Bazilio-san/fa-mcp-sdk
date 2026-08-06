import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { formatInputRequired, formatToolResult, IToolHandlerParams, TToolHandlerResponse } from '../../core/index.js';

import { ITemplateTool } from './tool.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * `example_confirm` — a destructive tool that asks the user to confirm before it acts, using the
 * Multi Round-Trip Requests (MRTR) pattern of MCP 2026-07-28.
 *
 * How the round trip works:
 *   1. The first call has no answer yet, so the handler returns {@link formatInputRequired} with an
 *      `elicitation/create` request. The client sees `resultType: "input_required"` and asks the
 *      user; the `state` we pass is sealed into the opaque `requestState` blob (HMAC-protected,
 *      keyed by `mcp.mrtr.stateSecret`).
 *   2. The client retries the SAME call with the user's answers. The handler now receives
 *      `params.inputResponses` plus the verified `params.requestStatePayload` — integrity, TTL and
 *      principal/method binding have already been checked, so a tampered blob never gets here.
 *
 * Nothing is stored on the server between the rounds: everything needed to resume travels in
 * `requestState`, which is what makes the pattern work behind a plain load balancer.
 *
 * A client that cannot deliver elicitation (it did not declare the capability, or it speaks a
 * legacy protocol revision over a session) receives an actionable `isError: true` explanation
 * instead — the handler itself stays the same.
 */
const definition: Tool = {
  name: 'example_confirm',
  title: 'Example: confirm before acting',
  description: `Example destructive tool that asks the user for confirmation before it proceeds (multi round-trip request).

Call this when the user asks to delete, purge or otherwise destroy something e.g.:
- "delete the temporary files"
- "purge the cache"

RISK LEVEL: high — the operation is destructive and irreversible.
SIDE EFFECTS: removes the named items permanently. The tool never acts without an explicit user confirmation:
it first returns a confirmation request, and only performs the deletion after the user accepts.
IDEMPOTENCY: none — a second confirmed call deletes whatever matches at that moment.
RETRY: safe to retry only when the previous attempt did not reach the confirmed stage.`,
  inputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'What to delete, e.g. "temporary files" or a path',
      },
    },
    required: ['target'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
} as Tool;

/** The shape we round-trip through `requestState` — small, and never secret (it is signed, not encrypted). */
interface IConfirmState {
  target: string;
}

function handler(params: IToolHandlerParams): TToolHandlerResponse {
  const { target } = params.arguments || {};

  const answer = params.inputResponses?.confirm as { action?: string; content?: { confirm?: boolean } } | undefined;

  if (!answer) {
    // Round 1: nothing to act on yet — ask the user.
    return formatInputRequired({
      inputRequests: {
        confirm: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: `Delete ${target}? This cannot be undone.`,
            requestedSchema: {
              type: 'object',
              properties: {
                confirm: { type: 'boolean', description: 'Confirm the deletion' },
              },
              required: ['confirm'],
            },
          },
        },
      },
      state: { target } satisfies IConfirmState,
    });
  }

  // Round 2: the user answered. `requestStatePayload` is our own verified state from round 1 —
  // prefer it over the arguments, since it is the value the server itself sealed.
  const restored = params.requestStatePayload as IConfirmState | undefined;
  const confirmedTarget = restored?.target ?? target;

  if (answer.action !== 'accept' || answer.content?.confirm !== true) {
    return formatToolResult({
      deleted: false,
      target: confirmedTarget,
      reason: 'The user declined the confirmation.',
    });
  }

  // Real tools would perform the deletion here.
  return formatToolResult({
    deleted: true,
    target: confirmedTarget,
    deletedAt: new Date().toISOString(),
  });
}

export const exampleConfirm: ITemplateTool = { definition, handler };
