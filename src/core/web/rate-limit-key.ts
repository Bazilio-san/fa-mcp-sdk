import { createHash } from 'node:crypto';

import { appConfig } from '../bootstrap/init-config.js';

interface IRateLimitRequest {
  ip?: string | undefined;
  auth?: any;
  authInfo?: any;
}

/** Build a stable, PII-safe rate-limit bucket without collapsing case-sensitive principals. */
export function resolveRateLimitKey(req: IRateLimitRequest, suffix: string = ''): string {
  const scope = appConfig.mcp.rateLimit?.scope ?? 'subject';
  let key = '';
  if (scope === 'subject') {
    const auth = req.auth ?? req.authInfo;
    const principal = typeof auth?.principal === 'string' ? auth.principal.trim() : '';
    if (principal) {
      key = `principal:${principal}`;
    } else {
      const payload = auth?.payload;
      const identity = payload?.sub ?? payload?.user ?? auth?.username;
      if (identity !== undefined && String(identity).trim()) {
        // JWT subjects and custom usernames are case-sensitive. Hash the exact value so distinct
        // principals never share a bucket and the raw identity never enters limiter state/logs.
        const digest = createHash('sha256').update(String(identity).trim(), 'utf8').digest('hex');
        key = `subject:${digest}`;
      }
    }
  }
  if (!key) {
    key = `ip:${req.ip || 'unknown'}`;
  }
  return suffix ? `${suffix}-${key}` : key;
}
