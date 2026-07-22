import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'node:module';
import * as path from 'path';

import { Router, Request, Response } from 'express';
import * as yaml from 'js-yaml';
import swaggerUiExpress from 'swagger-ui-express';

import { appConfig, ROOT_PROJECT_DIR } from '../index.js';
import { logInternalError } from '../errors/errors.js';

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
  security?: Array<Record<string, string[]>>;
}

type TsoaCli = typeof import('@tsoa/cli');

const projectRequire = createRequire(path.join(ROOT_PROJECT_DIR, 'package.json'));

function loadGenerateSpec(): TsoaCli['generateSpec'] | null {
  try {
    return (projectRequire('@tsoa/cli') as TsoaCli).generateSpec;
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
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
async function generateSpecOnDemand(specPath: string): Promise<OpenAPISpecResponse | null> {
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

    const needsAuth = !!appConfig.webServer?.auth?.enabled;
    const servers = buildServersArray();

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

    // The compiler is a project-local development/build dependency. Production serves the generated spec and falls
    // back to a minimal safe document when a consumer did not generate one before deployment.
    const generateSpec = loadGenerateSpec();
    if (!generateSpec) {
      throw new Error('OpenAPI generator unavailable; build with @tsoa/cli and deploy swagger/openapi.yaml.');
    }
    await generateSpec(specConfig);

    if (existsSync(specPath)) {
      console.log('OpenAPI specification generated successfully via tsoa programmatic API');
      return null;
    }

    // If tsoa didn't generate the file, create fallback
    throw new Error('tsoa did not generate specification file');
  } catch (error: any) {
    logInternalError(error, 'openapi_spec_generation');

    // Create fallback OpenAPI specification
    const fallbackSpec: OpenAPISpecResponse = {
      openapi: '3.0.0',
      info: {
        title: appConfig.productName || 'MCP Server API',
        version: appConfig.version || '1.0.0',
        description:
          appConfig.description || 'REST API for your MCP Server. This specification is automatically generated.',
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
      tags: [{ name: 'Server', description: 'Server management endpoints' }],
    };

    // Persist the fallback as a best-effort cache only. Production images are commonly read-only;
    // the in-memory document below must still keep /docs and /api/openapi.* available there.
    try {
      const specDir = path.dirname(specPath);
      if (!existsSync(specDir)) {
        mkdirSync(specDir, { recursive: true });
      }
      writeFileSync(specPath, yaml.dump(fallbackSpec), 'utf8');
      console.log('Fallback OpenAPI specification created successfully');
    } catch (writeError: unknown) {
      logInternalError(writeError, 'openapi_fallback_persist');
    }
    return fallbackSpec;
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
export async function configureOpenAPI(apiRouter?: Router | null): Promise<{
  swaggerUi?: any;
  swaggerSpecs?: any;
} | null> {
  if (!apiRouter) {
    return null;
  }

  try {
    // Try to load the generated OpenAPI spec
    const specPath = path.join(process.cwd(), 'swagger/openapi.yaml');

    let openAPISpec: OpenAPISpecResponse;
    if (!existsSync(specPath)) {
      // Generate OpenAPI spec on-demand if it doesn't exist
      console.log('OpenAPI specification not found. Generating on-demand...');
      const fallbackSpec = await generateSpecOnDemand(specPath);
      if (fallbackSpec) {
        openAPISpec = fallbackSpec;
      } else {
        const specContent = readFileSync(specPath, 'utf8');
        openAPISpec = parseOpenAPISpec(specContent);
      }
    } else {
      openAPISpec = parseOpenAPISpec(readFileSync(specPath, 'utf8'));
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
    logInternalError(error, 'openapi_configuration');
    return null;
  }
}

function parseOpenAPISpec(specContent: string): OpenAPISpecResponse {
  try {
    // Try YAML first (tsoa default)
    return yaml.load(specContent) as OpenAPISpecResponse;
  } catch {
    // Fallback to JSON
    return JSON.parse(specContent) as OpenAPISpecResponse;
  }
}

/**
 * Enhances the OpenAPI specification with dynamic configuration
 */
function enhanceOpenAPISpec(spec: OpenAPISpecResponse): OpenAPISpecResponse {
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
    enhanced.security ??= [{ bearerAuth: [] }];
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
function buildServersArray(): Array<{ url: string; description: string }> {
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
function createOpenAPIRoutes(router: Router, spec: OpenAPISpecResponse): void {
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
function createSwaggerUIMiddleware(spec: OpenAPISpecResponse) {
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
export function createSwaggerUIAssetsMiddleware() {
  return swaggerUiExpress.serve;
}
