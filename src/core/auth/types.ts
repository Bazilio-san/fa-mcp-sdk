/**
 * Types and interfaces for fa-mcp-sdk authentication system
 */

// ========================================================================
// JWT TOKENS AND LEGACY TYPES
// ========================================================================

export type TTokenType = 'permanent' | 'JWT';

export interface ITokenPayload {
  user: string,
  expire: number,

  [key: string]: any,
}

export interface ICheckTokenResult {
  inTokenType?: TTokenType
  payload?: ITokenPayload,
  // errorReason is returned only if there is an error. If it is empty, the check is OK
  errorReason?: string,
  isTokenDecrypted?: boolean,
}

// ========================================================================
// MULTI-AUTHENTICATION - NEW TYPES
// ========================================================================

export type AuthType = 'permanentServerTokens' | 'jwtToken' | 'pat' | 'basic' | 'oauth2';

export interface AuthDetectionResult {
  configured: AuthType[];
  valid: AuthType[];
  errors: Record<string, string[]>;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  authType?: AuthType;
  tokenType?: string;
  username?: string;
  accessToken?: string;
  payload?: any;
}

/**
 * Authentication check order in ascending CPU load
 */
export const AUTH_PRIORITY_ORDER: Record<AuthType, number> = {
  'permanentServerTokens': 1,  // O(1) Set.has()
  'pat': 2,                    // String and length validation
  'basic': 3,                  // Base64 decoding
  'jwtToken': 4,               // Symmetric decryption + JSON.parse
  'oauth2': 5,                  // Potentially HTTP requests
};
