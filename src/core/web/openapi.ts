import { Router, Request, Response } from 'express';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import swaggerUiExpress from 'swagger-ui-express';
import { appConfig, ROOT_PROJECT_DIR } from '../index.js';

/**
 * OpenAPI specification response interface
 */
export interface OpenAPISpecResponse {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, any>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
  tags?: Array<{
    name: string;
    description: string;
  }>;
}

/**
 * Swagger UI configuration interface
 */
export interface SwaggerUIConfig {
  customCss?: string;
  customSiteTitle?: string;
  customfavIcon?: string;
  swaggerOptions?: {
    persistAuthorization?: boolean;
    displayRequestDuration?: boolean;
    docExpansion?: string;
    defaultModelsExpandDepth?: number;
    urls?: Array<{
      name: string;
      url: string;
    }>;
  };
}

/**
 * Generate OpenAPI specification on-demand using tsoa programmatic API
 */
async function generateSpecOnDemand (specPath: string): Promise<void> {
  try {
    // Ensure directory exists
    const specDir = path.dirname(specPath);
    if (!existsSync(specDir)) {
      mkdirSync(specDir, { recursive: true });
    }
    let controllerPathGlobs = ['./src/api/*.ts'];
    let entryFile = './src/api/router.ts';
    if (existsSync(path.join(ROOT_PROJECT_DIR, 'src/template/api/router.ts'))) {
      controllerPathGlobs = ['./src/template/api/*.ts'];
      entryFile = './src/template/api/router.ts';
    }

    // перед generateSpec
    const needsAuth = !!appConfig.webServer?.auth?.enabled;
    const servers = buildServersArray(); // уже есть в файле, можно вызывать

    // ExtendedSpecConfig structure for generateSpec
    const specConfig = {
      outputDirectory: specDir,
      specVersion: 3 as const,
      specFileBaseName: 'openapi',
      yaml: true,
      entryFile,
      noImplicitAdditionalProperties: 'throw-on-extras' as const,
      controllerPathGlobs,

      // Info metadata
      name: appConfig.productName || 'MCP Server API',
      version: appConfig.version || '1.0.0',
      description: appConfig.description,

      spec: {
        ...(needsAuth && {
          security: [{ bearerAuth: [] }],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'JWT authorization token',
              },
            },
          },
        }),

        // If the top-level name/version/description fields are not applied by your version of tsoa, you can duplicate the info here:
        info: {
          title: appConfig.productName || 'MCP Server API',
          version: appConfig.version || '1.0.0',
          description: appConfig.description,
        },

        // In case top-level servers are not available in your version of tsoa:
        servers,
      },

      // How to merge spec with what tsoa will generate
      specMerging: 'recursive' as const,
    };

    // Use tsoa programmatic API
    const { generateSpec } = await import('tsoa');
    await generateSpec(specConfig);

    if (existsSync(specPath)) {
      console.log('OpenAPI specification generated successfully via tsoa programmatic API');
      return;
    }

    // If tsoa didn't generate the file, create fallback
    throw new Error('tsoa did not generate specification file');

  } catch (error: any) {
    console.warn('tsoa spec generation failed, creating fallback spec:', error.message);

    // Create fallback OpenAPI specification
    const fallbackSpec: OpenAPISpecResponse = {
      openapi: '3.0.0',
      info: {
        title: appConfig.productName || 'MCP Server API',
        version: appConfig.version || '1.0.0',
        description: appConfig.description || 'REST API for your MCP Server. This specification is automatically generated.',
      },
      servers: buildServersArray(),
      paths: {
        '/api/health': {
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
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        timestamp: { type: 'string' },
                        version: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      tags: [
        { name: 'Server', description: 'Server management endpoints' },
      ],
    };

    const { writeFileSync } = await import('fs');
    writeFileSync(specPath, yaml.dump(fallbackSpec), 'utf8');
    console.log('Fallback OpenAPI specification created successfully');
  }
}

/**
 * Automatically configures and serves OpenAPI documentation for APIs with tsoa
 * decorators
 *
 * This function:
 * 1. Detects if OpenAPI spec exists (generated by tsoa)
 * 2. Creates OpenAPI and Swagger UI routes automatically
 * 3. Serves documentation when apiRouter is provided
 *
 * @param apiRouter - Express router with tsoa-decorated endpoints
 * @returns Object with swaggerSpecs and swaggerUi middleware, or null if apiRouter not provided
 */
export async function configureOpenAPI (apiRouter?: Router | null): Promise<{
  swaggerUi?: any;
  swaggerSpecs?: any;
} | null> {
  if (!apiRouter) {
    return null;
  }

  try {
    // Try to load the generated OpenAPI spec
    const specPath = path.join(process.cwd(), 'swagger/openapi.yaml');

    if (!existsSync(specPath)) {
      // Generate OpenAPI spec on-demand if it doesn't exist
      console.log('OpenAPI specification not found. Generating on-demand...');
      try {
        await generateSpecOnDemand(specPath);
      } catch (error) {
        console.warn('Failed to generate OpenAPI specification:', error);
        return null;
      }
    }

    // Load OpenAPI spec
    const specContent = readFileSync(specPath, 'utf8');
    let openAPISpec: OpenAPISpecResponse;

    try {
      // Try YAML first (tsoa default)
      openAPISpec = yaml.load(specContent) as OpenAPISpecResponse;
    } catch {
      // Fallback to JSON
      openAPISpec = JSON.parse(specContent) as OpenAPISpecResponse;
    }

    // Enhance spec with dynamic configuration
    const enhancedSpec = enhanceOpenAPISpec(openAPISpec);

    // Create OpenAPI documentation routes
    createOpenAPIRoutes(apiRouter, enhancedSpec);

    // Return swagger-compatible objects for backward compatibility
    return {
      swaggerUi: createSwaggerUIMiddleware(enhancedSpec),
      swaggerSpecs: enhancedSpec,
    };

  } catch (error) {
    console.error('Failed to configure OpenAPI documentation:', error);
    return null;
  }
}

/**
 * Enhances the OpenAPI specification with dynamic configuration
 */
function enhanceOpenAPISpec (spec: OpenAPISpecResponse): OpenAPISpecResponse {
  const enhanced = { ...spec };

  // Update info from app config
  enhanced.info = {
    ...spec.info,
    title: appConfig.productName || 'MCP Server API',
    version: appConfig.version || '1.0.0',
  };

  // Build servers array from config with fallback
  enhanced.servers = buildServersArray();

  // Add default security scheme if auth is configured
  if (appConfig.webServer?.auth?.enabled) {
    enhanced.components = enhanced.components || {};
    enhanced.components.securitySchemes = {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT authorization token',
      },
      ...enhanced.components.securitySchemes,
    };
  }

  return enhanced;
}

/**
 * Builds servers array from configuration
 */
function buildServersArray (): Array<{ url: string; description: string }> {
  const servers = [];

  // Use servers from config if available
  if (appConfig.swagger?.servers?.length) {
    appConfig.swagger.servers.forEach((server: any) => {
      servers.push({
        url: server.url,
        description: server.description,
      });
    });
  } else {
    // Fallback to default development server
    servers.push({
      url: `http://localhost:${appConfig.webServer.port}`,
      description: 'Development server',
    });
  }

  return servers;
}

/**
 * Creates OpenAPI documentation routes on the provided router
 */
function createOpenAPIRoutes (router: Router, spec: OpenAPISpecResponse): void {
  // OpenAPI specification endpoint
  router.get('/openapi.json', (req: Request, res: Response) => {
    res.json(spec);
  });

  router.get('/openapi.yaml', (req: Request, res: Response) => {
    res.type('application/yaml').send(yaml.dump(spec));
  });
}

/**
 * Creates Swagger UI middleware function
 */
function createSwaggerUIMiddleware (spec: OpenAPISpecResponse) {
  const swaggerUiConfig: SwaggerUIConfig = {
    customSiteTitle: `${spec.info.title} Documentation`,
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 2,
      urls: [
        {
          name: 'API Specification',
          url: '/api/openapi.json',
        },
      ],
    },
  };

  return swaggerUiExpress.setup(spec, swaggerUiConfig);
}

/**
 * Serve Swagger UI static assets
 */
export function createSwaggerUIAssetsMiddleware () {
  return swaggerUiExpress.serve;
}
