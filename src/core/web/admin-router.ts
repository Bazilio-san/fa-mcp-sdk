/**
 * Admin panel router - Token Generator & Validator
 * Endpoints for JWT token generation and validation
 */

import { Router, Request, Response } from 'express';
import chalk from 'chalk';
import { appConfig } from '../bootstrap/init-config.js';
import { checkJwtToken, generateToken } from '../auth/jwt.js';
import { getHTMLPage } from '../auth/token-generator/html.js';
import { isNTLMEnabled } from '../auth/token-generator/ntlm/ntlm-domain-config.js';
import { getSessionStats } from '../auth/token-generator/ntlm/ntlm-session-storage.js';
import { getLoginPageHTML } from '../auth/token-generator/ntlm/ntlm-templates.js';
import { AdminAuthType, createAdminAuthMW } from '../auth/admin-auth.js';
import { logger as lgr } from '../logger.js';

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

/**
 * Creates admin router with all token generation endpoints
 */
export function createAdminRouter (): Router {
  const router = Router();

  // Apply admin authentication middleware to all admin routes
  const adminAuthMW = createAdminAuthMW();
  router.use(adminAuthMW);

  // Main admin page - Token Generator UI
  router.get('/', (req: Request, res: Response) => {
    const username = req.ntlm?.username || 'Unknown';
    const domain = req.ntlm?.domain || 'Unknown';
    const isAuthenticated = req.ntlm?.isAuthenticated || false;

    logger.info(`Admin page accessed by: ${domain}\\${username} (Authenticated: ${isAuthenticated})`);

    // Pass auth status to the HTML page
    res.send(getHTMLPage({
      isAuthenticated,
      username,
      domain,
      ntlmEnabled,
    }));
  });

  // Login page (for NTLM)
  router.get('/login', (req: Request, res: Response) => {
    res.send(getLoginPageHTML(req.ntlm?.username || ''));
  });

  // Logout endpoint
  router.get('/logout', (req: Request, res: Response) => {
    logger.info(`Logout requested by: ${req.ntlm?.domain || 'Unknown'}\\${req.ntlm?.username || 'Unknown'}`);

    if (adminAuthType === 'ntlm') {
      // NTLM logout - send 401 to trigger browser auth prompt
      res.setHeader('WWW-Authenticate', 'NTLM');
      res.setHeader('Clear-Site-Data', '"cookies", "storage"');
      return res.status(401).send('Authentication required - please login again');
    }

    // For other auth types, just clear the session indication
    res.setHeader('Clear-Site-Data', '"cookies", "storage"');
    return res.status(401).json({
      success: true,
      message: 'Logged out successfully',
    });
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
  router.post('/api/generate-token', (req: Request, res: Response) => {
    try {
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

      res.json({
        success: true,
        authType: adminAuthType,
        ntlmEnabled,
        isAuthenticated,
        user: isAuthenticated ? `${domain}\\${username}` : null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.json({
        success: false,
        error: error.message,
        authType: adminAuthType,
        ntlmEnabled,
      });
    }
  });

  return router;
}
