/**
 * Примеры использования системы мультиаутентификации fa-mcp-sdk
 */

import express from 'express';
import {
  enhancedAuthTokenMW,
  createConfigurableAuthMiddleware,
  getMultiAuthError,
  getAuthInfo
} from './middleware.js';
import { checkMultiAuth, detectAuthConfiguration, logAuthConfiguration } from './multi-auth.js';
import { appConfig } from '../bootstrap/init-config.js';

// ========================================================================
// ПРИМЕР 1: ПРОСТАЯ ЗАМЕНА MIDDLEWARE
// ========================================================================

const app = express();

// Вместо старого authTokenMW используем enhancedAuthTokenMW
app.use('/api', enhancedAuthTokenMW);

app.get('/api/protected', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({
    message: 'Access granted',
    authType: authInfo?.authType,
    username: authInfo?.username,
    tokenType: authInfo?.tokenType
  });
});

// ========================================================================
// ПРИМЕР 2: КОНФИГУРИРУЕМЫЙ MIDDLEWARE
// ========================================================================

// Middleware с логированием конфигурации при запуске
const authWithLogging = createConfigurableAuthMiddleware({
  logConfiguration: true,
  forceMultiAuth: false // Автоматически определяет нужна ли мультиаут
});

app.use('/api/v2', authWithLogging);

// ========================================================================
// ПРИМЕР 3: КАСТОМНАЯ ЛОГИКА АУТЕНТИФИКАЦИИ
// ========================================================================

app.use('/api/custom', (req, res, next) => {
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

  // Для остальных используем полную мультиаутентификацию
  const authError = getMultiAuthError(req);
  if (authError) {
    res.status(authError.code).send(authError.message);
    return;
  }
  next();
});

// ========================================================================
// ПРИМЕР 4: РОУТЕР С РАЗНЫМИ УРОВНЯМИ ДОСТУПА
// ========================================================================

const apiRouter = express.Router();

// Публичные роуты - без аутентификации
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

apiRouter.get('/info', (req, res) => {
  const authInfo = getAuthInfo();
  res.json({
    authEnabled: authInfo.enabled,
    configuredTypes: authInfo.configured,
    validTypes: authInfo.valid,
    usingMultiAuth: authInfo.usingMultiAuth
  });
});

// Защищенные роуты - с мультиаутентификацией
apiRouter.use('/protected', enhancedAuthTokenMW);

apiRouter.get('/protected/profile', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({
    profile: {
      authType: authInfo.authType,
      username: authInfo.username || 'anonymous',
      permissions: getPermissionsForAuthType(authInfo.authType)
    }
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
    case 'oauth2':
      data = { level: 'user', access: 'scoped', scopes: authInfo.payload?.scope };
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

app.post('/api/test-token', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  const authConfig = appConfig.webServer.auth;
  const result = checkMultiAuth(token, authConfig);

  return res.json({
    valid: result.success,
    authType: result.authType,
    tokenType: result.tokenType,
    error: result.error,
    username: result.username,
    hasPayload: !!result.payload
  });
});

// ========================================================================
// ПРИМЕР 6: MIDDLEWARE ДЛЯ РАЗНЫХ ТИПОВ API
// ========================================================================

// REST API - требует любую валидную аутентификацию
app.use('/rest', enhancedAuthTokenMW);

// GraphQL API - требует user-level аутентификацию (не server tokens)
app.use('/graphql', (req, res, next) => {
  const authError = getMultiAuthError(req);
  if (authError) {
    return res.status(authError.code).send(authError.message);
  }

  const authInfo = (req as any).authInfo;
  if (authInfo.authType === 'permanentServerTokens') {
    return res.status(403).json({
      error: 'GraphQL API requires user authentication, server tokens not allowed'
    });
  }

  return next();
});

// WebSocket API - только JWT токены (для real-time connections)
app.use('/ws', (req, res, next) => {
  const authError = getMultiAuthError(req);
  if (authError) {
    return res.status(authError.code).send(authError.message);
  }

  const authInfo = (req as any).authInfo;
  if (authInfo.authType !== 'jwtToken' && authInfo.authType !== 'oauth2') {
    return res.status(403).json({
      error: 'WebSocket API requires JWT or OAuth2 tokens for session management'
    });
  }

  return next();
});

// ========================================================================
// УТИЛИТНЫЕ ФУНКЦИИ
// ========================================================================

export function getPermissionsForAuthType (authType: string): string[] {
  const permissions: Record<string, string[]> = {
    'permanentServerTokens': ['read', 'write', 'admin', 'server'],
    'oauth2': ['read', 'write', 'user'],
    'jwtToken': ['read', 'write', 'session'],
    'pat': ['read', 'write', 'api'],
    'basic': ['read', 'basic']
  };

  return permissions[authType] || ['read'];
}

// ========================================================================
// ПРИМЕР 7: ИНИЦИАЛИЗАЦИЯ С ДИАГНОСТИКОЙ
// ========================================================================

export function initializeAuthSystem () {
  const authConfig = appConfig.webServer.auth;

  console.log('🔐 Initializing Multi-Authentication System...');

  // Диагностика конфигурации
  const detection = detectAuthConfiguration(authConfig);

  console.log('📊 Auth Configuration:');
  console.log(`   Enabled: ${authConfig.enabled}`);
  console.log(`   Configured: ${detection.configured.join(', ')}`);
  console.log(`   Valid: ${detection.valid.join(', ')}`);

  if (Object.keys(detection.errors).length > 0) {
    console.warn('⚠️  Configuration Issues:');
    Object.entries(detection.errors).forEach(([type, errors]) => {
      console.warn(`   ${type}: ${errors.join(', ')}`);
    });
  }

  // Логирование для отладки
  logAuthConfiguration(authConfig);

  console.log('✅ Multi-Authentication System initialized successfully');

  return {
    configured: detection.configured,
    valid: detection.valid,
    errors: detection.errors,
    usingMultiAuth: !!(authConfig.pat || authConfig.basic || authConfig.oauth2)
  };
}

// ========================================================================
// ПРИМЕР 8: ТЕСТИРОВАНИЕ КОНФИГУРАЦИИ
// ========================================================================

export async function testAuthConfiguration () {
  const authConfig = appConfig.webServer.auth;

  console.log('🧪 Testing Authentication Configuration...');

  const testCases = [
    // Тест permanent token
    {
      name: 'Permanent Server Token',
      token: authConfig.permanentServerTokens[0],
      expectedType: 'permanentServerTokens'
    },
    // Тест PAT
    {
      name: 'Personal Access Token',
      token: authConfig.pat,
      expectedType: 'pat'
    },
    // Тест basic auth
    {
      name: 'Basic Authentication',
      token: authConfig.basic
        ? Buffer.from(`${authConfig.basic.username}:${authConfig.basic.password}`).toString('base64')
        : undefined,
      expectedType: 'basic'
    },
    // Тест OAuth2
    {
      name: 'OAuth2 Bearer Token',
      token: authConfig.oauth2 ? `Bearer ${authConfig.oauth2.accessToken}` : undefined,
      expectedType: 'oauth2'
    }
  ];

  for (const testCase of testCases) {
    if (!testCase.token) {
      console.log(`⏭️  Skipping ${testCase.name}: not configured`);
      continue;
    }

    const result = checkMultiAuth(testCase.token, authConfig);

    if (result.success && result.authType === testCase.expectedType) {
      console.log(`✅ ${testCase.name}: PASSED`);
    } else {
      console.log(`❌ ${testCase.name}: FAILED - ${result.error || 'Unexpected auth type'}`);
    }
  }

  console.log('🧪 Authentication testing completed');
}

// ========================================================================
// ЭКСПОРТ ДЛЯ ИСПОЛЬЗОВАНИЯ
// ========================================================================
