/**
 * OAuth / OIDC discovery + token endpoints for fa-mcp-sdk.
 *
 * Mounted only when jwtToken.mode !== 'legacyAesCtr'.
 *
 * Endpoints:
 *   GET /.well-known/oauth-protected-resource (always, any non-legacy mode)
 *   GET /.well-known/openid-configuration     (only mode=embedded)
 *   GET /.well-known/jwks.json                (only mode=embedded; also mode=localKey)
 *   POST /oauth/token                          (only when KeyResolver canSign())
 *
 * The flow:
 *   - Resource servers ALWAYS expose /.well-known/oauth-protected-resource so MCP-aware
 *     clients can discover where to obtain tokens (per the MCP Authorization spec).
 *   - Embedded mode additionally exposes a full local IdP (jwks + openid-configuration +
 *     /oauth/token grant_type=password). The token endpoint reuses the configured
 *     Basic-auth credentials as the password store — no separate user DB.
 */

import chalk from 'chalk';
import { Request, Response, Router } from 'express';

import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';

import { checkBasicAuth } from '../auth/basic.js';
import { generateToken } from '../auth/jwt.js';
import { buildLocalJwks, getJwtRuntimeConfig, getKeyResolver } from '../auth/key-resolver.js';

const logger = lgr.getSubLogger({ name: chalk.bgYellow('oauth-router') });

/**
 * Compose the canonical issuer URL for embedded mode. Resolution order:
 *   1. expectedIssuer (config) — explicit, wins always
 *   2. Public webServer.host + port (if usable)
 *   3. http://localhost:<port>
 */
function getEmbeddedIssuer(req?: Request): string {
  const { expectedIssuer } = getJwtRuntimeConfig();
  if (expectedIssuer) {
    return expectedIssuer;
  }
  if (req) {
    const protocol = req.protocol || 'http';
    const host = req.get('host');
    if (host) {
      return `${protocol}://${host}`;
    }
  }
  const port = appConfig.webServer?.port;
  return `http://localhost:${port}`;
}

/**
 * Public URL of THIS resource server (used as `resource` in protected-resource metadata).
 */
function getResourceUrl(req: Request): string {
  const protocol = req.protocol || 'http';
  const host = req.get('host');
  if (host) {
    return `${protocol}://${host}`;
  }
  return `http://localhost:${appConfig.webServer?.port}`;
}

const TTL_MULTIPLIERS: Record<string, number> = { s: 1, m: 60, d: 86400, y: 31536000 };

/**
 * Build the express router with discovery + token endpoints.
 */
export function createOAuthRouter(): Router {
  const router = Router();
  const { mode } = getJwtRuntimeConfig();

  // ──────────────────────────────────────────────────────────────────────
  // RFC 9728 — Protected Resource Metadata (any non-legacy mode)
  // ──────────────────────────────────────────────────────────────────────
  router.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
    const resource = getResourceUrl(req);
    const issuer = getEmbeddedIssuer(req);
    res.json({
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:read', 'mcp:write'],
      resource_documentation: `${resource}/docs`,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // OIDC discovery + JWKS (embedded / localKey when keys are available)
  // ──────────────────────────────────────────────────────────────────────
  if (mode === 'embedded' || mode === 'localKey') {
    router.get('/.well-known/openid-configuration', (req: Request, res: Response) => {
      const issuer = getEmbeddedIssuer(req);
      res.json({
        issuer,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        token_endpoint: `${issuer}/oauth/token`,
        response_types_supported: ['token'],
        grant_types_supported: ['password'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
        id_token_signing_alg_values_supported: [getJwtRuntimeConfig().algorithm],
        subject_types_supported: ['public'],
        scopes_supported: ['mcp:read', 'mcp:write'],
      });
    });

    router.get('/.well-known/jwks.json', async (_req: Request, res: Response) => {
      try {
        const jwks = await buildLocalJwks();
        res.json(jwks);
      } catch (error: any) {
        logger.error('Failed to build JWKS', error);
        res.status(500).json({ error: 'jwks_unavailable', error_description: error?.message });
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // POST /oauth/token (grant_type=password) — embedded / localKey with privateKey
  // ──────────────────────────────────────────────────────────────────────
  router.post('/oauth/token', async (req: Request, res: Response) => {
    try {
      const resolver = await getKeyResolver();
      if (!resolver || !resolver.canSign()) {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'This server does not issue tokens. Obtain a token from the configured IdP.',
        });
      }

      const grantType = (req.body?.grant_type ?? req.query?.grant_type ?? '').toString();
      if (grantType !== 'password') {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: `Only grant_type=password is supported (got "${grantType}")`,
        });
      }

      const username = (req.body?.username ?? '').toString().trim();
      const password = (req.body?.password ?? '').toString();
      if (!username || !password) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'username and password are required',
        });
      }

      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      const auth = checkBasicAuth(encoded);
      if (!auth.success) {
        return res.status(401).json({
          error: 'invalid_grant',
          error_description: auth.error || 'Invalid credentials',
        });
      }

      const scope = (req.body?.scope ?? '').toString().trim() || undefined;
      const requestedTtl = (req.body?.ttl ?? '').toString().trim();
      let liveTimeSec: number = getJwtRuntimeConfig().defaultTtl;
      if (requestedTtl) {
        const match = /^(\d+)([smdy])$/.exec(requestedTtl);
        if (!match) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: `Invalid ttl "${requestedTtl}". Format: <N>s | <N>m | <N>d | <N>y`,
          });
        }
        liveTimeSec = parseInt(match[1]!, 10) * TTL_MULTIPLIERS[match[2]!]!;
      }

      const payload: Record<string, any> = {};
      if (scope) {
        payload.scope = scope;
      }

      const token = await generateToken(username, liveTimeSec, payload);
      return res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: liveTimeSec,
        ...(scope ? { scope } : {}),
      });
    } catch (error: any) {
      logger.error('oauth/token failed', error);
      return res.status(500).json({
        error: 'server_error',
        error_description: error?.message ?? 'unknown error',
      });
    }
  });

  return router;
}

/**
 * Build the `WWW-Authenticate: Bearer ...` header advertised on 401 responses.
 *
 * Compliance:
 *   - Standard §7.4: realm="<service>" is REQUIRED in every challenge.
 *   - `error="invalid_token"` is added only when the verifier could read the token
 *     (signature OK, claims invalid/expired) — distinguishes "no creds" vs "bad creds".
 *   - In non-legacy modes the MCP Authorization spec mandates resource_metadata=...
 */
export function buildWwwAuthenticateHeader(
  req: Request,
  ctx: { errorReason?: string | undefined; isTokenDecrypted?: boolean | undefined } | string = {},
): string {
  const opts: { errorReason?: string | undefined; isTokenDecrypted?: boolean | undefined } =
    typeof ctx === 'string' ? { errorReason: ctx, isTokenDecrypted: true } : ctx;
  const { mode } = getJwtRuntimeConfig();
  const realm = appConfig.name || 'mcp';
  const errParts: string[] = [];
  if (opts.isTokenDecrypted && opts.errorReason) {
    errParts.push(`error="invalid_token"`);
    errParts.push(`error_description="${String(opts.errorReason).replace(/"/g, '')}"`);
  }
  if (mode === 'legacyAesCtr') {
    return [`Bearer realm="${realm}"`, ...errParts].join(', ');
  }
  const resource = getResourceUrl(req);
  return [
    `Bearer realm="${realm}"`,
    `resource_metadata="${resource}/.well-known/oauth-protected-resource"`,
    ...errParts,
  ].join(', ');
}
