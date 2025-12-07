import { Router, Request, Response } from 'express';
import { logger, createAuthMW, IEndpointsOn404 } from '../../core/index.js';

export const apiRouter: Router | null = Router();

/**
 * Template for API routes
 * Modify this file to implement your specific API endpoints
 */

// Create universal auth middleware
const authMW = createAuthMW();

// Example protected endpoint using auth middleware
apiRouter.get('/example', authMW, async (req: Request, res: Response) => {
  try {
    logger.info('Example endpoint called');

    res.json({
      success: true,
      message: 'This is a template endpoint',
      data: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error in example endpoint:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export const endpointsOn404: IEndpointsOn404 = {
  myEndpoints1: ['/my-endpoint-1', '/my-endpoint-2'],
  myEndpoint3: '/my-endpoint-3',
};
