import { ICheckTokenResult } from './types.js';
import { trim } from '../utils/utils.js';
import { appConfig } from '../bootstrap/init-config.js';

const pt = appConfig.webServer?.auth?.permanentServerTokens || [];
const permanentServerTokensSet: Set<string> = new Set(Array.isArray(pt) ? pt : [pt]);

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
