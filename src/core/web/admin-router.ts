/**
 * Admin panel router - Token Generator & Validator
 * Endpoints for JWT token generation and validation
 */

import { Router, Request, Response } from 'express';
import chalk from 'chalk';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { checkJwtToken, generateToken } from '../auth/jwt.js';
import { isNTLMEnabled } from '../auth/token-generator/ntlm/ntlm-domain-config.js';
import { getSessionStats } from '../auth/token-generator/ntlm/ntlm-session-storage.js';
import { getLoginPageHTML } from '../auth/token-generator/ntlm/ntlm-templates.js';
import { AdminAuthType, createAdminAuthMW } from '../auth/admin-auth.js';
import { logger as lgr } from '../logger.js';
import { TokenGenAuthInput } from '../_types_/types.js';
import { AuthResult } from '../auth/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to static files (relative to compiled JS location in dist/)
const staticPath = join(__dirname, 'static/token-gen');

const logger = lgr.getSubLogger({ name: chalk.bgCyan('admin-router') });

const timeToSeconds: Record<'minutes' | 'hours' | 'days' | 'months' | 'years', number> = {
  minutes: 60,
  hours: 60 * 60,
  days: 60 * 60 * 24,
  months: 60 * 60 * 24 * 30,
  years: 60 * 60 * 24 * 365,
};

const { adminAuth } = appConfig.webServer || {};
const adminAuthType: AdminAuthType | undefined = adminAuth?.enabled === true ? adminAuth.type : undefined;
const ntlmEnabled = adminAuthType === 'ntlm' && isNTLMEnabled;

// Check if auth type requires Bearer token (handled by frontend modal)
const requiresBearerToken = adminAuthType === 'permanentServerTokens' || adminAuthType === 'jwtToken';

/**
 * Checks custom authorization for Token Generator access
 * Returns null if authorized, or AuthResult with error if not
 */
async function checkTokenGenAuthorization (req: Request): Promise<AuthResult | null> {
  const projectData = getProjectData();
  const handler = projectData?.tokenGenAuthHandler;

  // If no custom handler is configured, allow access
  if (typeof handler !== 'function') {
    return null;
  }

  // Build input based on auth type
  const input: TokenGenAuthInput = {
    user: req.ntlm?.username || 'Unknown',
    authType: (adminAuthType || 'permanentServerTokens') as TokenGenAuthInput['authType'],
  };

  // Add domain for NTLM
  if (adminAuthType === 'ntlm' && req.ntlm?.domain) {
    input.domain = req.ntlm.domain;
  }

  // Add payload for JWT
  if (adminAuthType === 'jwtToken') {
    input.payload = (req as any).authPayload;
  }

  try {
    const result = await handler(input);
    if (!result.success) {
      logger.info(`Token Generator authorization denied for ${input.user}: ${result.error}`);
      return result;
    }
    return null; // Authorized
  } catch (error: any) {
    logger.error('Token Generator authorization handler error:', error);
    return {
      success: false,
      error: `Authorization check failed: ${error.message}`,
    };
  }
}

/**
 * Creates admin router with all token generation endpoints
 */
export function createAdminRouter (): Router {
  const router = Router();

  // ============================
  // PUBLIC ENDPOINTS (no auth required)
  // ============================

  // Public endpoint - auth config (frontend needs this to know if token modal is required)
  router.get('/api/auth-config', (req: Request, res: Response) => {
    res.json({
      success: true,
      authType: adminAuthType || null,
      requiresBearerToken,
      timestamp: new Date().toISOString(),
    });
  });

  // Main admin page - always serve HTML (auth is handled by frontend for Bearer tokens)
  // For NTLM/Basic - middleware will handle auth before this route
  if (requiresBearerToken) {
    // For Bearer token auth: serve page without auth, frontend will handle token modal
    router.get('/', (req: Request, res: Response) => {
      logger.info('Admin page accessed (Bearer token auth - frontend handles authentication)');
      res.sendFile(join(staticPath, 'index.html'));
    });

    // Logout for Bearer token auth - just return success, frontend clears sessionStorage
    router.get('/logout', (req: Request, res: Response) => {
      res.setHeader('Clear-Site-Data', '"storage"');
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully',
      });
    });
  }

  // ============================
  // PROTECTED ENDPOINTS (auth required)
  // ============================

  // Apply admin authentication middleware to protected routes
  const adminAuthMW = createAdminAuthMW();
  router.use(adminAuthMW);

  // Note: Static files (CSS, JS) are served globally at /static/token-gen/ by server-http.ts

  // Main admin page - for NTLM/Basic auth (middleware already authenticated)
  if (!requiresBearerToken) {
    router.get('/', (req: Request, res: Response) => {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const isAuthenticated = req.ntlm?.isAuthenticated || false;

      logger.info(`Admin page accessed by: ${domain}\\${username} (Authenticated: ${isAuthenticated})`);
      res.sendFile(join(staticPath, 'index.html'));
    });

    // Logout for NTLM auth
    router.get('/logout', (req: Request, res: Response) => {
      logger.info(`Logout requested by: ${req.ntlm?.domain || 'Unknown'}\\${req.ntlm?.username || 'Unknown'}`);

      if (adminAuthType === 'ntlm') {
        res.setHeader('WWW-Authenticate', 'NTLM');
        res.setHeader('Clear-Site-Data', '"cookies", "storage"');
        return res.status(401).send('Authentication required - please login again');
      }

      // For basic auth
      res.setHeader('Clear-Site-Data', '"cookies", "storage"');
      return res.status(401).json({
        success: true,
        message: 'Logged out successfully',
      });
    });
  }

  // Login page (for NTLM)
  router.get('/login', (req: Request, res: Response) => {
    res.send(getLoginPageHTML(req.ntlm?.username || ''));
  });

  // Debug endpoint for session stats (development only)
  router.get('/debug/sessions', (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Not available in production' });
    }

    const stats = getSessionStats();
    return res.json({
      message: 'Admin Panel Session Statistics',
      timestamp: new Date().toISOString(),
      ...stats,
    });
  });

  // API: Generate token
  router.post('/api/generate-token', async (req: Request, res: Response) => {
    try {
      // Check custom authorization
      const authError = await checkTokenGenAuthorization(req);
      if (authError) {
        return res.status(403).json({
          success: false,
          error: authError.error || 'Authorization denied',
        });
      }

      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const authenticatedUser = `${domain}\\${username}`;

      const { user, timeValue, timeUnit, payload } = req.body as {
        user?: string;
        timeValue?: number;
        timeUnit?: keyof typeof timeToSeconds;
        payload?: Record<string, any>;
      };

      if (!user || !timeValue || !timeUnit) {
        logger.info(`Token generation failed (missing parameters) by: ${authenticatedUser}`);
        return res.json({
          success: false,
          error: 'Need to fill in the user and token lifetime',
        });
      }

      const multiplier = timeToSeconds[timeUnit];
      if (!multiplier) {
        logger.info(`Token generation failed (invalid time unit) by: ${authenticatedUser}`);
        return res.json({
          success: false,
          error: 'Invalid Time Unit',
        });
      }

      const liveTimeSec = timeValue * multiplier;
      const token = generateToken(user, liveTimeSec, payload || {});

      logger.info(`Generated token for user: ${user}, duration: ${timeValue} ${timeUnit}, requested by: ${authenticatedUser}`);

      return res.json({
        success: true,
        token: token,
      });

    } catch (error: any) {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      logger.error(`Error generating token for ${domain}\\${username}:`, error);
      return res.json({
        success: false,
        error: error.message,
      });
    }
  });

  // API: Validate token
  router.post('/api/validate-token', (req: Request, res: Response) => {
    try {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const authenticatedUser = `${domain}\\${username}`;

      const { token } = req.body as { token?: string };

      if (!token) {
        logger.info(`Token validation failed (no token provided) by: ${authenticatedUser}`);
        return res.json({
          success: false,
          error: 'Token Not Transferred',
        });
      }

      const result = checkJwtToken({ token });

      if (result.errorReason) {
        logger.info(`Token validation failed (${result.errorReason}) by: ${authenticatedUser}`);
        return res.json({
          success: false,
          error: result.errorReason,
        });
      }

      logger.info(`Token validated successfully for user: ${result.payload?.user}, requested by: ${authenticatedUser}`);

      return res.json({
        success: true,
        payload: result.payload,
      });

    } catch (error: any) {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      logger.error(`Error validating token for ${domain}\\${username}:`, error);
      return res.json({
        success: false,
        error: error.message,
      });
    }
  });

  // API: Service info
  router.get('/api/service-info', (req: Request, res: Response) => {
    try {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const isAuthenticated = req.ntlm?.isAuthenticated || false;

      logger.info(`Service info requested by: ${domain}\\${username}`);

      res.json({
        success: true,
        serviceName: appConfig.name,
        primaryColor: appConfig.uiColor.primary,
        authenticatedUser: `${domain}\\${username}`,
        isAuthenticated,
        authType: adminAuthType,
        ntlmEnabled,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      logger.error(`Error getting service info for ${domain}\\${username}:`, error);
      res.json({
        success: false,
        error: error.message,
        serviceName: appConfig.name,
        authType: adminAuthType,
        ntlmEnabled,
      });
    }
  });

  // API: Auth status
  router.get('/api/auth-status', (req: Request, res: Response) => {
    try {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const isAuthenticated = req.ntlm?.isAuthenticated || false;

      // Determine if logout is available (for all auth types except disabled)
      const canLogout = isAuthenticated && !!adminAuthType;

      // Format user display based on auth type
      let userDisplay: string | null = null;
      if (isAuthenticated) {
        if (adminAuthType === 'ntlm') {
          userDisplay = `${domain}\\${username}`;
        } else {
          userDisplay = username;
        }
      }

      res.json({
        success: true,
        authType: adminAuthType || null,
        isAuthenticated,
        user: userDisplay,
        canLogout,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.json({
        success: false,
        error: error.message,
        authType: adminAuthType || null,
      });
    }
  });

  return router;
}
