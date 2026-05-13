import { appConfig } from '../bootstrap/init-config.js';
import { trim } from '../utils/utils.js';

const revoked = appConfig.webServer?.auth?.revoked || ({} as any);

const entries: string[] = (Array.isArray(revoked.jwtTokens) ? revoked.jwtTokens : [])
  .map((e: any) => trim(e?.token))
  .filter(Boolean);

// Full-token entries (legacy `<expire>.<hex>` or full standard JWT `a.b.c`) — exact match
const revokedExactTokenSet: Set<string> = new Set(entries.filter((v) => v.includes('.')));

// Bare jti entries (no dots) — match by JWT id
const revokedJtiSet: Set<string> = new Set(entries.filter((v) => !v.includes('.')));

const revokedUsersSet: Set<string> = new Set(
  (Array.isArray(revoked.users) ? revoked.users : []).map((u: any) => trim(u).toLowerCase()).filter(Boolean),
);

export const isJwtTokenRevoked = (token: string): boolean => revokedExactTokenSet.has(trim(token));

export const isJtiRevoked = (jti: string): boolean => revokedJtiSet.has(trim(jti));

export const isUserRevoked = (user: string): boolean => revokedUsersSet.has(trim(user).toLowerCase());
