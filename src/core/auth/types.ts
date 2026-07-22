/**
 * Types and interfaces for fa-mcp-sdk authentication system
 */

export type TTokenType = 'permanent' | 'JWT';

export interface ITokenPayload {
  /** Canonical JWT subject, preserved verbatim for audit/rate-limit correlation. */
  sub?: string;
  /** Employee identity derived only from configured `userClaim`, or from `sub` when unset. */
  user: string;
  expire: number; // ms
  iat?: string; // normalized ISO string for backward compatibility
  service?: string; // normalized aud
  jti?: string;
  iss?: string;
  ip?: string;

  [key: string]: any;
}

export interface ICheckTokenResult {
  payload?: ITokenPayload;
  // errorReason is returned only if there is an error. If it is empty, the check is OK
  errorReason?: string;
  isTokenDecrypted?: boolean;
}

export type AuthType = 'permanentServerTokens' | 'jwtToken' | 'basic' | 'custom';

export interface AuthDetectionResult {
  configured: AuthType[];
  configuredSet: Set<AuthType>;
  configuredTypes: string;
  errors: Record<string, string[]>;
}

export interface AuthResult {
  success: boolean;
  error?: string;

  authType?: AuthType;
  username?: string;
  /**
   * Stable, non-secret principal identifier supplied by a custom validator for stateful transport
   * binding. Required when neither `username` nor `payload.sub` / `payload.user` is available.
   */
  sessionBinding?: string;
  /** SDK-generated, type-tagged opaque owner key. Custom validators must provide identity inputs instead. */
  principal?: string;
  isTokenDecrypted?: boolean | undefined; // only for JWT
  payload?: any;
  /**
   * Standard §7.4 — authenticated but not authorized. Triggers HTTP 403
   * (NO WWW-Authenticate challenge). Set by custom validators or scope checks.
   */
  forbidden?: boolean;
}
