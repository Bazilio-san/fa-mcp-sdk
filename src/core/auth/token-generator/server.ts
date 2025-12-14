import { appConfig } from '../../bootstrap/init-config.js';
import express, { Request, Response } from 'express';
import chalk from 'chalk';
import { checkJwtToken, generateToken } from '../jwt.js';
import { isMainModule } from '../../utils/utils.js';
import { setupNTLMAuthentication } from './ntlm/ntlm-integration.js';
import { isNTLMEnabled } from './ntlm/ntlm-domain-config.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const ntlmEnabled = isNTLMEnabled;

export const generateTokenApp = (port?: number) => {

  port = port || Number(process.env.TOKEN_GEN_PORT || 3030);

  const logger = {
    info: (msg: any, ...args: any[]) => console.log(chalk.cyan('[TOKEN-GEN]'), msg, ...args),
    error: (msg: any, ...args: any[]) => console.error(chalk.red('[TOKEN-GEN ERROR]'), msg, ...args),
  };

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static files (CSS, JS) - from unified static location
  const staticPath = join(__dirname, '../../web/static/token-gen');
  app.use('/static/token-gen', express.static(staticPath));

  // NTLM Authentication middleware
  if (isNTLMEnabled) {
    console.log(chalk.cyan('[TOKEN-GEN]'), 'Setting up NTLM authentication...');
    app.use(setupNTLMAuthentication());
  } else {
    console.log(chalk.yellow('[TOKEN-GEN]'), 'NTLM authentication is DISABLED - running without authentication');
    app.use(setupNTLMAuthentication());
  }

  const timeToSeconds: Record<'minutes' | 'hours' | 'days' | 'months' | 'years', number> = {
    minutes: 60,
    hours: 60 * 60,
    days: 60 * 60 * 24,
    months: 60 * 60 * 24 * 30,
    years: 60 * 60 * 24 * 365,
  };

  // Main page - Token Generator UI
  app.get('/', (req: Request, res: Response) => {
    const username = req.ntlm?.username || 'Unknown';
    const domain = req.ntlm?.domain || 'Unknown';
    const isAuthenticated = req.ntlm?.isAuthenticated || false;
    logger.info(`Token generation interface accessed by: ${domain}\\${username} (Authenticated: ${isAuthenticated})`);

    // Serve static index.html from unified static location
    res.sendFile(join(__dirname, '../../web/static/token-gen', 'index.html'));
  });

  // Logout endpoint
  app.get('/admin/logout', (req: Request, res: Response) => {
    logger.info(`Logout requested by: ${req.ntlm?.domain || 'Unknown'}\\${req.ntlm?.username || 'Unknown'}`);

    if (ntlmEnabled) {
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

  app.post('/admin/api/generate-token', (req: Request, res: Response) => {
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

  app.post('/admin/api/validate-token', (req: Request, res: Response) => {
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

  app.get('/admin/api/service-info', (req: Request, res: Response) => {
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
        serviceName: 'mcp-server', // fallback
        ntlmEnabled,
      });
    }
  });

  // Add endpoint for authentication status
  app.get('/admin/api/auth-status', (req: Request, res: Response) => {
    try {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const isAuthenticated = req.ntlm?.isAuthenticated || false;

      // Standalone server only supports NTLM auth
      const authType = ntlmEnabled ? 'ntlm' : null;
      const canLogout = isAuthenticated && ntlmEnabled;

      // Format user display for NTLM (domain\username)
      let userDisplay: string | null = null;
      if (isAuthenticated) {
        userDisplay = `${domain}\\${username}`;
      }

      res.json({
        success: true,
        authType,
        isAuthenticated,
        user: userDisplay,
        canLogout,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.json({
        success: false,
        error: error.message,
        authType: ntlmEnabled ? 'ntlm' : null,
      });
    }
  });

  return app.listen(port, () => {
    logger.info(`Token Generator Server started on port ${port}`);
    logger.info(`Open http://localhost:${port} in your browser`);

    if (isNTLMEnabled) {
      logger.info('NTLM authentication is ENABLED - valid domain credentials required');
    } else {
      logger.info('NTLM authentication is DISABLED - running without authentication');
    }

    logger.info('Press Ctrl+C to stop the server');
  });
};

// Auto-start if this file is run directly
if (isMainModule(import.meta.url)) {
  generateTokenApp();
}
