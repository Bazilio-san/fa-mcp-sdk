/**
 * Claims whose meaning is owned by JWT itself or by the SDK authorization/audit pipeline.
 * `jwtToken.userClaim` must never alias one of these fields: doing so could replace an IP or
 * scope policy value with an employee login, or make the normalized identity overwrite metadata.
 */
export const RESERVED_USER_CLAIMS: ReadonlySet<string> = new Set([
  'iss',
  'sub',
  'aud',
  'exp',
  'nbf',
  'iat',
  'jti',
  'user',
  'expire',
  'service',
  'ip',
  'scope',
  'allow',
]);
