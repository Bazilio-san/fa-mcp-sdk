import { Route, Get, Security, Tags } from '@tsoa/runtime';
import { Router, Request, Response } from 'express';

import { createAuthMW, logger, logInternalError } from '../../core/index.js';

export const apiRouter: Router | null = Router();

// Create universal auth middleware
const authMW = createAuthMW();

// Example response interfaces for tsoa
export interface ExampleResponse {
  success: boolean;
  message: string;
  data: {
    timestamp: string;
  };
}

/**
 * Example TSOA Controller
 * This demonstrates how to use tsoa decorators for automatic OpenAPI generation
 */
@Route('api')
export class ExampleController {
  /**
   * Example protected endpoint
   * Template endpoint - customize as needed
   */
  @Get('example')
  @Security('bearerAuth')
  @Tags('Example')
  public async getExample(): Promise<ExampleResponse> {
    try {
      logger.info('Example endpoint called');

      return {
        success: true,
        message: 'This is a template endpoint',
        data: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      logInternalError(error, 'example_endpoint');
      throw new Error('Internal error', { cause: error });
    }
  }

  /**
   * Health check endpoint
   * Simple health check for monitoring
   */
  @Get('health')
  @Tags('Server')
  public async getHealth(): Promise<{
    status: string;
    timestamp: string;
    version: string;
  }> {
    const { appConfig } = await import('../../core/index.js');

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: appConfig.version || '1.0.0',
    };
  }
}

// Manual Express routes for backward compatibility and custom endpoints
// Example protected endpoint using auth middleware
apiRouter.get('/example', authMW, async (req: Request, res: Response) => {
  try {
    logger.info('Example endpoint called');

    res.json({
      success: true,
      message: 'This is a template endpoint',
      data: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logInternalError(error, 'example_endpoint');
    res.status(500).json({
      success: false,
      error: 'Internal error',
    });
  }
});
