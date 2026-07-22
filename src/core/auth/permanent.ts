import { appConfig } from '../bootstrap/init-config.js';
import { trim } from '../utils/utils.js';

import { ICheckTokenResult } from './types.js';

const pt = appConfig.webServer?.auth?.permanentServerTokens || [];

/** Opaque service tokens are secret-store credentials; reject empty, placeholder and weak values. */
export const isValidPermanentTokenConfig = (token: unknown): token is string => {
  const value = trim(token);
  return value.length >= 20 && value !== '***' && value.toLowerCase() !== 'token';
};

const permanentServerTokensSet: Set<string> = new Set(
  (Array.isArray(pt) ? pt : [pt]).filter(isValidPermanentTokenConfig).map(trim),
);

/**
 * Checks the validity of the permanent server token:
 */
export const checkPermanentToken = (token: string): ICheckTokenResult => {
  token = trim(token);
  if (!token) {
    return { errorReason: 'Token not passed' };
  }
  return permanentServerTokensSet.has(token) ? {} : { errorReason: 'Invalid permanent token' };
};
