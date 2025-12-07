/**
 * Примеры использования системы мультиаутентификации fa-mcp-sdk
 */

import express from 'express';
import {
  appConfig,
  createAuthMW,
  getMultiAuthError,
  checkMultiAuth,
  checkCombinedAuth,
  detectAuthConfiguration,
  logAuthConfiguration,
  McpServerData,
  CustomAuthValidator,
  AuthResult,
} from '../../core/index.js';

// ========================================================================
// ПРИМЕР:
// ========================================================================

const app = express();

// Middleware с логированием конфигурации при запуске
process.env.LOG_AUTH_CONFIG = 'true';
const authWithLogging = createAuthMW();

app.use('/api/v2', authWithLogging);

// ========================================================================
// ПРИМЕР 3: КАСТОМНАЯ ЛОГИКА АУТЕНТИФИКАЦИИ
// ========================================================================

app.use('/api/custom', async (req, res, next) => {
  // Публичные эндпоинты
  if (req.path.startsWith('/api/custom/public')) {
    return next();
  }

  // Для админских эндпоинтов требуем только permanent tokens
  if (req.path.startsWith('/api/custom/admin')) {
    const token = (req.headers.authorization || '').replace(/^Bearer */, '');
    const auth = appConfig.webServer.auth;

    if (auth.permanentServerTokens.includes(token)) {
      return next();
    } else {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }

  try {
    // Для остальных используем полную мультиаутентификацию
    const authError = await getMultiAuthError(req);
    if (authError) {
      res.status(authError.code).send(authError.message);
      return;
    }
    next();
  } catch {
    res.status(500).send('Authentication error');
    return;
  }
});

// ========================================================================
// ПРИМЕР 4: РОУТЕР С РАЗНЫМИ УРОВНЯМИ ДОСТУПА
// ========================================================================

const apiRouter = express.Router();

// Публичные роуты - без аутентификации
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Защищенные роуты - с мультиаутентификацией
apiRouter.use('/protected', authWithLogging);

apiRouter.get('/protected/profile', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({
    profile: {
      authType: authInfo.authType,
      username: authInfo.username || 'anonymous',
      permissions: getPermissionsForAuthType(authInfo.authType),
    },
  });
});

apiRouter.get('/protected/data', (req, res) => {
  const authInfo = (req as any).authInfo;

  // Разные данные в зависимости от типа аутентификации
  let data;
  switch (authInfo.authType) {
    case 'permanentServerTokens':
      data = { level: 'server', access: 'full' };
      break;
    case 'basic':
      data = { level: 'basic', access: 'limited', username: authInfo.username };
      break;
    case 'pat':
      data = { level: 'api', access: 'token-based' };
      break;
    case 'jwtToken':
      data = { level: 'jwt', access: 'custom', payload: authInfo.payload };
      break;
    default:
      data = { level: 'unknown', access: 'none' };
  }

  res.json({ data, authInfo: authInfo.authType });
});

app.use('/api/v3', apiRouter);

// ========================================================================
// ПРИМЕР 5: ПРОГРАММНОЕ ТЕСТИРОВАНИЕ ТОКЕНОВ
// ========================================================================

app.post('/api/test-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const result = await checkMultiAuth(req);

    return res.json({
      valid: result.success,
      authType: result.authType,
      tokenType: result.tokenType,
      error: result.error,
      username: result.username,
      hasPayload: !!result.payload,
    });
  } catch {
    return res.status(500).json({ error: 'Authentication test failed' });
  }
});

// ========================================================================
// ПРИМЕР 6: MIDDLEWARE ДЛЯ РАЗНЫХ ТИПОВ API
// ========================================================================

// REST API - требует любую валидную аутентификацию
app.use('/rest', authWithLogging);

// GraphQL API - требует user-level аутентификацию (не server tokens)
app.use('/graphql', async (req, res, next) => {
  try {
    const authError = await getMultiAuthError(req);
    if (authError) {
      return res.status(authError.code).send(authError.message);
    }

    const authInfo = (req as any).authInfo;
    if (authInfo.authType === 'permanentServerTokens') {
      return res.status(403).json({
        error: 'GraphQL API requires user authentication, server tokens not allowed',
      });
    }

    return next();
  } catch {
    return res.status(500).send('Authentication error');
  }
});

// WebSocket API - только JWT токены (для real-time connections)
app.use('/ws', async (req, res, next) => {
  try {
    const authError = await getMultiAuthError(req);
    if (authError) {
      return res.status(authError.code).send(authError.message);
    }

    const authInfo = (req as any).authInfo;
    if (authInfo.authType !== 'jwtToken') {
      return res.status(403).json({
        error: 'WebSocket API requires JWT tokens for session management',
      });
    }

    return next();
  } catch {
    return res.status(500).send('Authentication error');
  }
});

// ========================================================================
// ПРИМЕР 7: ИСПОЛЬЗОВАНИЕ CHECKCOMBIПEDAUTH С КАСТОМНОЙ ВАЛИДАЦИЕЙ
// ========================================================================

// Пример кастомной функции аутентификации
const customAuthValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  // Черный ящик для кастомной логики аутентификации
  const userHeader = req.headers['x-user-id'];
  const apiKey = req.headers['x-api-key'];
  const clientIP = req.headers['x-real-ip'] || req.connection?.remoteAddress;

  try {
    // Пример: проверка IP-адреса из whitelist
    const allowedIPs = ['127.0.0.1', '192.168.1.0/24'];
    if (!(await isIPAllowed(clientIP, allowedIPs))) {
      return { success: false, error: `IP address ${clientIP} not in whitelist` };
    }

    // Пример: проверка специального API ключа
    if (apiKey && userHeader) {
      const isValidKey = await validateApiKeyForUser(apiKey, userHeader);
      if (!isValidKey) {
        return { success: false, error: 'Invalid API key for user' };
      }

      return {
        success: true,
        authType: 'basic',
        tokenType: 'apiKey',
        username: userHeader,
        payload: {
          clientIP,
          apiKeyPrefix: apiKey.substring(0, 8) + '...',
          validatedAt: new Date().toISOString()
        }
      };
    }

    // Пример: проверка времени работы (только рабочие часы)
    const now = new Date();
    const hour = now.getHours();
    const isWorkingHours = hour >= 9 && hour <= 17;

    if (!isWorkingHours) {
      return { success: false, error: 'Access only allowed during business hours (9-17)' };
    }

    // Пример: проверка заголовка User-Agent
    const userAgent = req.headers['user-agent'];
    if (userAgent?.includes('bot') || userAgent?.includes('crawler')) {
      return { success: false, error: 'Bots and crawlers are not allowed' };
    }

    // Разрешаем доступ с базовой информацией
    return {
      success: true,
      authType: 'basic',
      tokenType: 'custom',
      username: `guest-${clientIP}`,
      payload: {
        clientIP,
        userAgent,
        accessTime: new Date().toISOString(),
        businessHoursAccess: isWorkingHours
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Custom authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

// Демонстрация использования checkCombinedAuth напрямую
app.post('/api/combined-auth-test', async (req, res) => {
  try {
    // checkCombinedAuth проверяет и стандартную auth + кастомный валидатор
    const result = await checkCombinedAuth(req);

    if (result.success) {
      res.json({
        message: 'Combined authentication successful',
        authType: result.authType,
        tokenType: result.tokenType,
        username: result.username,
      });
    } else {
      res.status(401).json({
        error: 'Combined authentication failed',
        reason: result.error,
      });
    }
  } catch {
    res.status(500).json({ error: 'Authentication system error' });
  }
});

// Пример middleware, который использует combined auth
const combinedAuthMiddleware = async (req: any, res: any, next: any) => {
  try {
    const result = await checkCombinedAuth(req);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    // Добавляем информацию об аутентификации в request
    req.authInfo = {
      authType: result.authType,
      tokenType: result.tokenType,
      username: result.username,
      payload: result.payload,
    };

    next();
  } catch {
    res.status(500).json({ error: 'Authentication error' });
  }
};

app.use('/api/protected-combined', combinedAuthMiddleware);

app.get('/api/protected-combined/data', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({
    message: 'Access granted with combined auth',
    auth: authInfo,
    timestamp: new Date().toISOString(),
  });
});

// ========================================================================
// ПРИМЕР 8: КОНФИГУРАЦИЯ MCP СЕРВЕРА С КАСТОМНЫМ ВАЛИДАТОРОМ
// ========================================================================

// Пример того, как настроить MCP сервер с кастомным валидатором
const mcpServerDataExample: McpServerData = {
  tools: [],
  toolHandler: async () => ({}),
  agentBrief: 'Example MCP Server with Custom Auth',
  agentPrompt: 'An example server demonstrating custom authentication',

  // Кастомный валидатор аутентификации
  customAuthValidator: async (req): Promise<AuthResult> => {
    console.log('🔐 Custom auth validator called');

    try {
      // Логика валидации может быть любой:
      const authHeader = req.headers.authorization;
      const specialToken = req.headers['x-special-token'];
      const clientCert = req.headers['x-client-cert'];

      // Пример 1: Проверка специального токена
      if (specialToken === 'secret-company-token-2024') {
        console.log('✅ Authentication via special token');
        return {
          success: true,
          authType: 'basic',
          tokenType: 'specialToken',
          username: 'company-user',
          payload: {
            tokenType: 'company',
            issuedAt: new Date().toISOString(),
            level: 'company-wide'
          }
        };
      }

      // Пример 2: Проверка клиентского сертификата
      if (clientCert && (await validateClientCertificate(clientCert))) {
        console.log('✅ Authentication via client certificate');
        return {
          success: true,
          authType: 'basic',
          tokenType: 'clientCert',
          username: 'cert-user',
          payload: {
            certificateFingerprint: clientCert.substring(0, 32) + '...',
            validatedAt: new Date().toISOString(),
            level: 'certificate-based'
          }
        };
      }

      // Пример 3: Интеграция с внешней системой аутентификации
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const isValid = await validateExternalToken(token);
        if (isValid) {
          console.log('✅ Authentication via external system');
          return {
            success: true,
            authType: 'basic',
            tokenType: 'externalToken',
            username: 'external-user',
            payload: {
              tokenPrefix: token.substring(0, 8) + '...',
              validatedAt: new Date().toISOString(),
              level: 'external-system'
            }
          };
        }
      }

      console.log('❌ Custom authentication failed');
      return { success: false, error: 'No valid authentication method found' };
    } catch (error) {
      console.log('❌ Custom authentication error:', error);
      return {
        success: false,
        error: `Custom authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  },
};

// Утилитные функции для примеров
async function isIPAllowed (ip: string, allowedIPs: string[]): Promise<boolean> {
  // Заглушка для проверки IP
  return allowedIPs.some(allowed => ip.includes(allowed.split('/')[0]!));
}

async function validateApiKeyForUser (apiKey: string, userId: string): Promise<boolean> {
  // Заглушка для проверки API ключа пользователя
  return apiKey.length > 20 && userId.length > 0;
}

async function validateClientCertificate (cert: string): Promise<boolean> {
  // Заглушка для проверки клиентского сертификата
  return cert.includes('-----BEGIN CERTIFICATE-----');
}

async function validateExternalToken (token: string): Promise<boolean> {
  // Заглушка для проверки токена во внешней системе
  try {
    // Здесь может быть HTTP запрос к внешней системе
    return token.length > 10;
  } catch {
    return false;
  }
}

// ========================================================================
// УТИЛИТНЫЕ ФУНКЦИИ
// ========================================================================

function getPermissionsForAuthType (authType: string): string[] {
  const permissions: Record<string, string[]> = {
    'permanentServerTokens': ['read', 'write', 'admin', 'server'],
    'jwtToken': ['read', 'write', 'session'],
    'pat': ['read', 'write', 'api'],
    'basic': ['read', 'basic'],
  };

  return permissions[authType] || ['read'];
}

// ========================================================================
// ПРИМЕР 9: ИНИЦИАЛИЗАЦИЯ С ДИАГНОСТИКОЙ
// ========================================================================

function initializeAuthSystem () {
  console.log('🔐 Initializing Multi-Authentication System...');

  // Диагностика конфигурации
  const { configured, errors } = detectAuthConfiguration();

  console.log('📊 Auth Configuration:');
  console.log(`   Enabled: ${!!appConfig.webServer?.auth?.enabled}`);
  console.log(`   Configured: ${configured.join(', ')}`);

  if (Object.keys(errors).length > 0) {
    console.warn('⚠️  Configuration Issues:');
    Object.entries(errors).forEach(([type, errors]) => {
      console.warn(`   ${type}: ${(errors as string[]).join(', ')}`);
    });
  }

  // Логирование для отладки
  logAuthConfiguration();

  console.log('✅ Multi-Authentication System initialized successfully');

  return {
    configured: configured,
    errors: errors,
  };
}

// ========================================================================
// ПРИМЕР 11: ТЕСТИРОВАНИЕ COMBINED AUTH
// ========================================================================

async function testCombinedAuth () {
  console.log('🧪 Testing Combined Authentication...');

  // Создаем тестовый запрос
  const mockRequest = {
    headers: {
      authorization: 'Bearer test-token',
      'x-user-id': 'test-user',
      'x-api-key': 'test-api-key-12345',
      'user-agent': 'PostmanRuntime/7.28.0',
    },
    connection: { remoteAddress: '127.0.0.1' },
  };

  try {
    // @ts-ignore
    const result = await checkCombinedAuth(mockRequest);

    if (result.success) {
      console.log('✅ Combined authentication test: PASSED');
      console.log(`   Auth Type: ${result.authType}`);
      console.log(`   Token Type: ${result.tokenType}`);
      console.log(`   Username: ${result.username || 'N/A'}`);
    } else {
      console.log('❌ Combined authentication test: FAILED');
      console.log(`   Error: ${result.error}`);
    }
  } catch (error) {
    console.log('❌ Combined authentication test: ERROR');
    console.log(`   Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  console.log('🧪 Combined authentication testing completed');
}

// ========================================================================
// ЭКСПОРТ ДЛЯ ИСПОЛЬЗОВАНИЯ
// ========================================================================

// Экспортируем все функции и примеры для использования
export {
  // Примеры конфигурации
  mcpServerDataExample,
  customAuthValidator,
  combinedAuthMiddleware,

  // Функции тестирования
  initializeAuthSystem,
  testCombinedAuth,

  // Утилиты
  getPermissionsForAuthType,
};
