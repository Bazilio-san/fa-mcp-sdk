import { appConfig } from '../bootstrap/init-config.js';
import { trim } from '../utils/utils.js';

const revoked = appConfig.webServer?.auth?.revoked || ({} as any);

const revokedTokensSet: Set<string> = new Set(
  (Array.isArray(revoked.jwtTokens) ? revoked.jwtTokens : [])
    .map((e: any) => trim(e?.token))
    .filter(Boolean),
);

const revokedUsersSet: Set<string> = new Set(
  (Array.isArray(revoked.users) ? revoked.users : [])
    .map((u: any) => trim(u).toLowerCase())
    .filter(Boolean),
);

export const isJwtTokenRevoked = (token: string): boolean => revokedTokensSet.has(trim(token));

export const isUserRevoked = (user: string): boolean => revokedUsersSet.has(trim(user).toLowerCase());
