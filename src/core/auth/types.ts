/**
 * Types and interfaces for fa-mcp-sdk authentication system
 */

export type TTokenType = 'permanent' | 'JWT';

export interface ITokenPayload {
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
  isTokenDecrypted?: boolean | undefined; // only for JWT
  payload?: any;
  /**
   * Standard §7.4 — authenticated but not authorized. Triggers HTTP 403
   * (NO WWW-Authenticate challenge). Set by custom validators or scope checks.
   */
  forbidden?: boolean;
}
