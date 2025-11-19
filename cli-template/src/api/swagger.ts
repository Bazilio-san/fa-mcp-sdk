import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { appConfig } from 'fa-mcp-sdk';

/**
 * Generic Swagger configuration template for MCP Server
 * Customize this file according to your API endpoints and schemas
 */

// Build servers array from config with fallback
const buildServers = () => {
  const servers = [];

  // Use servers from config if available
  if (appConfig.swagger?.servers?.length) {
    appConfig.swagger.servers.forEach((server: any) => {
      servers.push({
        url: server.url,
        description: server.description
      });
    });
  } else {
    // Fallback to default development server
    servers.push({
      url: `http://localhost:${appConfig.webServer.port}`,
      description: 'Development server'
    });
  }

  return servers;
};

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MCP Server API',
      version: appConfig.version,
      description: `
        REST API for your MCP Server. This is a template configuration.
        Customize the endpoints, schemas, and documentation according to your needs.
      `,
    },
    servers: buildServers(),
    components: {
      schemas: {
        HealthResponse: {
          type: 'object',
          description: 'Health check response',
          properties: {
            status: {
              type: 'string',
              example: 'ok'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-11-05T12:00:00.000Z'
            },
            version: {
              type: 'string',
              example: '1.0.0'
            }
          },
          required: ['status', 'timestamp', 'version']
        },
        ErrorResponse: {
          type: 'object',
          description: 'Error response format',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates failed operation',
              example: false
            },
            error: {
              type: 'string',
              description: 'Human-readable error message',
              example: 'Validation failed'
            },
            code: {
              type: 'string',
              description: 'Error code for programmatic handling',
              example: 'VALIDATION_ERROR'
            }
          },
          required: ['success', 'error', 'code']
        }
      }
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          description: 'Simple health check endpoint for monitoring',
          tags: ['Server'],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/HealthResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/example': {
        get: {
          summary: 'Example endpoint',
          description: 'Template endpoint - customize as needed',
          tags: ['Example'],
          responses: {
            '200': {
              description: 'Success response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                        example: true
                      },
                      message: {
                        type: 'string',
                        example: 'Template endpoint response'
                      }
                    }
                  }
                }
              }
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ErrorResponse'
                  }
                }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Server',
        description: 'Server management endpoints'
      },
      {
        name: 'Example',
        description: 'Template endpoints to customize'
      }
    ]
  },
  apis: [] // Add your API files here if using JSDoc comments
};

const swaggerSpecs = swaggerJsdoc(options);

export const swagger = { swaggerSpecs, swaggerUi };
