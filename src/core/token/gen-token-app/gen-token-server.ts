import { appConfig } from '../../bootstrap/init-config.js';
import express, { Request, Response } from 'express';
import chalk from 'chalk';
import { getHTMLPage } from './html.js';
import { checkToken, generateToken } from '../token-core.js';
import { isMainModule } from '../../utils/utils.js';

export const generateTokenApp = (port?: number) => {

  port = port || Number(process.env.TOKEN_GEN_PORT || 3030);

  const logger = {
    info: (msg: any, ...args: any[]) => console.log(chalk.cyan('[TOKEN-GEN]'), msg, ...args),
    error: (msg: any, ...args: any[]) => console.error(chalk.red('[TOKEN-GEN ERROR]'), msg, ...args),
  };

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const timeToSeconds: Record<'minutes' | 'hours' | 'days' | 'months' | 'years', number> = {
    minutes: 60,
    hours: 60 * 60,
    days: 60 * 60 * 24,
    months: 60 * 60 * 24 * 30,
    years: 60 * 60 * 24 * 365,
  };

  app.get('/', (_req: Request, res: Response) => {
    res.send(getHTMLPage());
  });

  app.post('/api/generate-token', (req: Request, res: Response) => {
    try {
      const { user, timeValue, timeUnit, payload } = req.body as {
        user?: string;
        timeValue?: number;
        timeUnit?: keyof typeof timeToSeconds;
        payload?: Record<string, any>;
      };

      if (!user || !timeValue || !timeUnit) {
        return res.json({
          success: false,
          error: 'Need to fill in the user and token lifetime',
        });
      }

      const multiplier = timeToSeconds[timeUnit];
      if (!multiplier) {
        return res.json({
          success: false,
          error: 'Invalid Time Unit',
        });
      }

      const liveTimeSec = timeValue * multiplier;
      const token = generateToken(user, liveTimeSec, payload || {});

      logger.info(`Generated token for user: ${user}, duration: ${timeValue} ${timeUnit}`);

      return res.json({
        success: true,
        token: token,
      });

    } catch (error: any) {
      logger.error('Error generating token:', error);
      return res.json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post('/api/validate-token', (req: Request, res: Response) => {
    try {
      const { token } = req.body as { token?: string };

      if (!token) {
        return res.json({
          success: false,
          error: 'Token Not Transferred',
        });
      }

      const result = checkToken({ token });

      if ('errorReason' in result) {
        return res.json({
          success: false,
          error: result.errorReason,
        });
      }

      logger.info(`Token validated successfully for user: ${result.payload?.user}`);

      return res.json({
        success: true,
        payload: result.payload,
        tokenType: result.inTokenType,
      });

    } catch (error: any) {
      logger.error('Error validating token:', error);
      return res.json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/service-info', (_req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        serviceName: appConfig.name,
      });
    } catch (error: any) {
      logger.error('Error getting service info:', error);
      res.json({
        success: false,
        error: error.message,
        serviceName: 'mcp-server', // fallback
      });
    }
  });

  return app.listen(port, () => {
    logger.info(`Token Generator Server started on port ${port}`);
    logger.info(`Open http://localhost:${port} in your browser`);
    logger.info('Press Ctrl+C to stop the server');
  });
};

// Auto-start if this file is run directly
if (isMainModule(import.meta.url)) {
  generateTokenApp();
}
