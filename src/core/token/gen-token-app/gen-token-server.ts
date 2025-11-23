import { appConfig } from '../../bootstrap/init-config.js';
import express, { Request, Response } from 'express';
import chalk from 'chalk';
import { getHTMLPage } from './html.js';
import { checkToken, generateToken } from '../token-core.js';
import { isMainModule } from '../../utils/utils.js';
import { setupNTLMAuthentication } from './ntlm-integration.js';
import { isNTLMEnabled } from './ntlm-domain-config.js';

export const generateTokenApp = (port?: number) => {

  port = port || Number(process.env.TOKEN_GEN_PORT || 3030);

  const logger = {
    info: (msg: any, ...args: any[]) => console.log(chalk.cyan('[TOKEN-GEN]'), msg, ...args),
    error: (msg: any, ...args: any[]) => console.error(chalk.red('[TOKEN-GEN ERROR]'), msg, ...args),
  };

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // NTLM Authentication middleware
  if (isNTLMEnabled()) {
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

  app.get('/', (req: Request, res: Response) => {
    const username = req.ntlm?.username || 'Unknown';
    const domain = req.ntlm?.domain || 'Unknown';
    const isAuthenticated = req.ntlm?.isAuthenticated || false;
    logger.info(`Token generation interface accessed by: ${domain}\\${username} (Authenticated: ${isAuthenticated})`);

    // Pass NTLM status to the HTML page
    res.send(getHTMLPage({
      isAuthenticated,
      username,
      domain,
      ntlmEnabled: isNTLMEnabled()
    }));
  });

  app.post('/api/generate-token', (req: Request, res: Response) => {
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

  app.post('/api/validate-token', (req: Request, res: Response) => {
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

      const result = checkToken({ token });

      if ('errorReason' in result) {
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
        tokenType: result.inTokenType,
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

  app.get('/api/service-info', (req: Request, res: Response) => {
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
        ntlmEnabled: isNTLMEnabled(),
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
        ntlmEnabled: isNTLMEnabled(),
      });
    }
  });

  // Add endpoint for authentication status
  app.get('/api/auth-status', (req: Request, res: Response) => {
    try {
      const username = req.ntlm?.username || 'Unknown';
      const domain = req.ntlm?.domain || 'Unknown';
      const isAuthenticated = req.ntlm?.isAuthenticated || false;

      res.json({
        success: true,
        ntlmEnabled: isNTLMEnabled(),
        isAuthenticated,
        user: isAuthenticated ? `${domain}\\${username}` : null,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.json({
        success: false,
        error: error.message,
        ntlmEnabled: isNTLMEnabled(),
      });
    }
  });

  return app.listen(port, () => {
    logger.info(`Token Generator Server started on port ${port}`);
    logger.info(`Open http://localhost:${port} in your browser`);

    if (isNTLMEnabled()) {
      logger.info('NTLM authentication is ENABLED - valid domain credentials required');
      logger.info(`Debug endpoints: http://localhost:${port}/debug/sessions (dev only)`);
    } else {
      logger.info('NTLM authentication is DISABLED - running without authentication');
    }

    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info('Press Ctrl+C to stop the server');
  });
};

// Auto-start if this file is run directly
if (isMainModule(import.meta.url)) {
  generateTokenApp();
}
