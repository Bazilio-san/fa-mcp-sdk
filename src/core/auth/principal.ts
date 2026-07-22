import { createHash } from 'node:crypto';

import { ITransportContext } from '../_types_/types.js';

import { AuthResult, AuthType } from './types.js';

export const MAX_AUTH_IDENTITY_LENGTH = 4096;
export const AUTH_PRINCIPAL_ERROR = 'MCP Auth: successful authentication requires a stable principal identity';

/** Identity material must be bounded and safe to use as an exact, case-sensitive hash input. */
export function isUsableAuthIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_AUTH_IDENTITY_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function opaquePrincipal(authType: string, source: string, exactValue: string): string {
  const digest = createHash('sha256').update(exactValue, 'utf8').digest('hex');
  return `${authType}:${source}:${digest}`;
}

/** Derive a stable, type-tagged opaque owner key without normalizing the case-sensitive identity. */
export function deriveAuthPrincipal(result: AuthResult, permanentCredential?: string): string | undefined {
  const authType: AuthType = result.authType ?? 'custom';
  const candidates: Array<[string, unknown]> =
    authType === 'permanentServerTokens'
      ? [
          ['token', permanentCredential],
          ['session', result.sessionBinding],
        ]
      : [
          ['sub', result.payload?.sub],
          ['user', result.payload?.user],
          ['username', result.username],
          ['session', result.sessionBinding],
        ];
  const selected = candidates.find(([, value]) => isUsableAuthIdentity(value));
  if (selected) {
    return opaquePrincipal(authType, selected[0], selected[1] as string);
  }
  return isUsableAuthIdentity(result.principal) ? result.principal : undefined;
}

export function normalizeAuthPrincipal(result: AuthResult, permanentCredential?: string): AuthResult {
  if (!result.success) {
    return result;
  }
  const principal = deriveAuthPrincipal(result, permanentCredential);
  if (principal) {
    return { ...result, principal };
  }
  return {
    success: false,
    ...(result.authType ? { authType: result.authType } : {}),
    ...(result.isTokenDecrypted !== undefined ? { isTokenDecrypted: result.isTokenDecrypted } : {}),
    error: AUTH_PRINCIPAL_ERROR,
  };
}

/** Internal owner key for tasks/concurrency; synthetic contexts remain case-sensitive and isolated. */
export function transportPrincipal(context: ITransportContext): string {
  if (isUsableAuthIdentity(context.principal)) {
    return context.principal;
  }
  if (isUsableAuthIdentity(context.payload?.sub)) {
    return opaquePrincipal('context', 'sub', context.payload.sub);
  }
  if (isUsableAuthIdentity(context.payload?.user)) {
    return opaquePrincipal('context', 'user', context.payload.user);
  }
  if (context.principal !== undefined || context.payload !== undefined) {
    throw new Error(AUTH_PRINCIPAL_ERROR);
  }
  return 'anonymous';
}
