/**
 * Types and interfaces for fa-mcp-sdk authentication system
 */

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

export type AuthType = 'permanentServerTokens' | 'jwtToken' | 'basic';

export interface AuthDetectionResult {
  configured: AuthType[];
  errors: Record<string, string[]>;
}

export interface AuthResult {
  success: boolean;
  error?: string;

  authType?: AuthType;
  tokenType?: string;
  username?: string;
  payload?: any;
}
