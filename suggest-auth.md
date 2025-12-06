# Система параллельных аутентификаций

## Поддерживаемые типы

1. **permanentServerTokens** ✅ - статические серверные токены (уже реализовано)
2. **jwtToken** ✅ - кастомные JWT с симметричным шифрованием (уже реализовано)
3. **pat** ⚠️ - персональные токены доступа (типы готовы, нужна реализация)
4. **basic** ⚠️ - базовая аутентификация (типы готовы, нужна реализация)
5. **oauth2** ⚠️ - OAuth2 токены (типы готовы, нужна реализация)

## Конфигурация

```typescript
// Точное соответствие AppConfig из fa-mcp-sdk
interface WebServerAuthConfig {
  enabled: boolean;
  permanentServerTokens: string[];  // ✅ Уже реализовано
  jwtToken: {                       // ✅ Уже реализовано
    encryptKey: string;
    checkMCPName: boolean;
  };
  basic?: {                         // ⚠️ Типы готовы, нужна реализация
    type: 'basic';
    username: string;
    password: string;
  };
  pat?: string;                     // ⚠️ Типы готовы, нужна реализация
  oauth2?: {                        // ⚠️ Типы готовы, нужна реализация
    type: 'oauth2';
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken?: string;
    redirectUri?: string;
    tokenEndpoint?: string;
  };
}
```

### Текущая конфигурация (config/default.yaml)

```yaml
webServer:
  auth:
    enabled: false
    # ✅ Уже работает - статические токены для сервера
    permanentServerTokens: []

    # ✅ Уже работает - JWT с симметричным шифрованием
    jwtToken:
      encryptKey: '***'
      checkMCPName: true

    # ⚠️ Закомментировано - нужна реализация
    #basic:
    #  username: '***'
    #  password: '***'

    # ⚠️ Закомментировано - нужна реализация
    #pat: '***'

    # ⚠️ Закомментировано - нужна реализация
    #oauth2:
    #  type: 'oauth2'
    #  clientId: '***'
    #  clientSecret: '***'
    #  redirectUri: 'string'
    #  tokenEndpoint: 'string'
```

### Расширенная конфигурация

```typescript
// Пример полной конфигурации со всеми типами
const authConfig: WebServerAuthConfig = {
  enabled: true,

  // ✅ Самые быстрые - уже реализованы
  permanentServerTokens: ["server-token-1", "server-token-2"],
  jwtToken: {
    encryptKey: "your-symmetric-key-256bit",
    checkMCPName: true
  },

  // ⚠️ Быстрые - нужна реализация
  pat: "ATATT3xFfGF0...",

  // ⚠️ Средние - нужна реализация
  basic: {
    type: 'basic',
    username: "admin",
    password: "secret123"
  },

  // ⚠️ Медленные - нужна реализация
  oauth2: {
    type: 'oauth2',
    clientId: "ari:cloud:ecosystem::app/...",
    clientSecret: "...",
    accessToken: "...",
    refreshToken: "...",
    redirectUri: "https://yourapp.com/oauth/callback"
  }
};
```

## Детекция сконфигурированных типов

```typescript
interface AuthDetectionResult {
  configured: string[];
  valid: string[];
  errors: Record<string, string[]>;
}

function detectAuthConfiguration(config: MultiAuthConfig): AuthDetectionResult {
  const result: AuthDetectionResult = {
    configured: [],
    valid: [],
    errors: {}
  };

  // Проверка permanentTokens
  if (config.permanentTokens.length > 0) {
    result.configured.push('permanentTokens');
    const validTokens = config.permanentTokens.filter(token =>
      typeof token === 'string' && token.length > 0
    );
    if (validTokens.length > 0) {
      result.valid.push('permanentTokens');
    } else {
      result.errors.permanentTokens = ['No valid tokens in array'];
    }
  }

  // Проверка PAT
  if (config.pat) {
    result.configured.push('pat');
    if (typeof config.pat === 'string' && config.pat.length > 10) {
      result.valid.push('pat');
    } else {
      result.errors.pat = ['Token too short or invalid'];
    }
  }

  // Проверка Basic Auth
  if (config.basic) {
    result.configured.push('basic');
    const errors = [];
    if (!config.basic.username) errors.push('Username missing');
    if (!config.basic.password) errors.push('Password missing');

    if (errors.length === 0) {
      result.valid.push('basic');
    } else {
      result.errors.basic = errors;
    }
  }

  // Проверка JWT Token
  if (config.jwtToken) {
    result.configured.push('jwtToken');
    if (config.jwtToken.encryptKey && config.jwtToken.encryptKey.length >= 8) {
      result.valid.push('jwtToken');
    } else {
      result.errors.jwtToken = ['Encryption key missing or too short'];
    }
  }

  // Проверка OAuth2
  if (config.oauth2) {
    result.configured.push('oauth2');
    const required = ['clientId', 'clientSecret', 'accessToken'];
    const missing = required.filter(field => !config.oauth2[field]);

    if (missing.length === 0) {
      result.valid.push('oauth2');
    } else {
      result.errors.oauth2 = [`Missing fields: ${missing.join(', ')}`];
    }
  }

  return result;
}
```

## Интеграция с текущей реализацией

### Текущее состояние fa-mcp-sdk

```typescript
// src/core/auth/jwt-validation.ts - УЖЕ РЕАЛИЗОВАНО
const { jwtToken, permanentServerTokens: pt = [] } = appConfig.webServer?.auth || {};
const permanentServerTokensSet: Set<string> = new Set(Array.isArray(pt) ? pt : [pt]);

export const checkToken = (arg: { token: string, expectedUser?: string, expectedService?: string }) => {
  // 1. ✅ Проверка permanentServerTokens - O(1)
  if (permanentServerTokensSet.has(token)) {
    return { inTokenType: 'permanent' };
  }

  // 2. ✅ Проверка JWT с симметричным шифрованием
  const [, expirePartStr, encryptedPayload] = tokenRE.exec(token) || [];
  if (expirePartStr && encryptedPayload) {
    // Расшифровка и валидация JWT...
    return { inTokenType: 'JWT', payload };
  }

  return { errorReason: 'Token validation failed' };
};
```

```typescript
// src/core/auth/middleware.ts - ТЕКУЩИЙ MIDDLEWARE
export const getAuthByTokenError = (req: Request) => {
  if (!enabled) return undefined;

  const token = getTokenFromHttpHeader(req);  // Извлечение Bearer токена
  if (!token) return debugAuth(req, 400, 'Missing authorization header');

  const checkResult = checkToken({ token });  // ✅ Только JWT + permanentTokens
  if (checkResult.errorReason) {
    return debugAuth(req, 401, checkResult.errorReason);
  }
  return undefined;
};
```

### Расширение для поддержки всех типов

```typescript
// Новая функция - расширение getAuthByTokenError()
export const getMultiAuthError = (req: Request): { code: number, message: string } | undefined => {
  const { auth } = appConfig.webServer;
  if (!auth.enabled) return undefined;

  const token = getTokenFromHttpHeader(req);
  if (!token) return debugAuth(req, 400, 'Missing authorization header');

  // Порядок по возрастанию CPU нагрузки
  const authTypes = detectValidAuthTypes(auth);

  for (const authType of authTypes) {
    try {
      const result = checkAuthType(authType, token, auth);
      if (result.success) {
        return undefined; // Успешная аутентификация
      }
    } catch (error) {
      console.warn(`Auth type ${authType} failed:`, error.message);
    }
  }

  return debugAuth(req, 401, 'Authentication failed for all configured methods');
};

function detectValidAuthTypes(auth: WebServerAuthConfig): string[] {
  const types = [];

  // ✅ Уже работает
  if (auth.permanentServerTokens?.length > 0) types.push('permanent');
  if (auth.jwtToken?.encryptKey) types.push('jwt');

  // ⚠️ Нужна реализация
  if (auth.pat) types.push('pat');
  if (auth.basic?.username && auth.basic?.password) types.push('basic');
  if (auth.oauth2?.clientId && auth.oauth2?.clientSecret) types.push('oauth2');

  return types;
}

function checkAuthType(type: string, token: string, config: WebServerAuthConfig): AuthResult {
  switch (type) {
    case 'permanent':
    case 'jwt':
      // ✅ Используем существующую реализацию
      const result = checkToken({ token });
      return result.errorReason
        ? { success: false, error: result.errorReason }
        : { success: true, tokenType: result.inTokenType, payload: result.payload };

    case 'pat':
      // ⚠️ Новая реализация
      if (token.startsWith('ATATT') && token.length > 20) {
        return { success: true, tokenType: 'pat' };
      }
      return { success: false, error: 'Invalid PAT format' };

    case 'basic':
      // ⚠️ Новая реализация
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [username, password] = decoded.split(':');
        if (username === config.basic.username && password === config.basic.password) {
          return { success: true, tokenType: 'basic', username };
        }
        return { success: false, error: 'Invalid credentials' };
      } catch {
        return { success: false, error: 'Invalid basic auth format' };
      }

    case 'oauth2':
      // ⚠️ Новая реализация
      if (!token.startsWith('Bearer ')) {
        return { success: false, error: 'OAuth2 requires Bearer token' };
      }
      // Здесь была бы валидация через OAuth introspection endpoint
      return { success: true, tokenType: 'oauth2' };

    default:
      return { success: false, error: `Unknown auth type: ${type}` };
  }
}

interface AuthResult {
  success: boolean;
  error?: string;
  tokenType?: string;
  username?: string;
  payload?: any;
}
```

### Обратная совместимость

```typescript
// Полная замена (breaking change)
export const authTokenMW = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/mcp' && isPublicMcpRequest(req)) {
    return next();
  }

  // Используем новую мульти-аут функцию
  const authError = getMultiAuthError(req);
  if (authError) {
    res.status(authError.code).send(authError.message);
    return;
  }
  next();
};
```

## Менеджер мультиавторизации

```typescript
import { checkToken } from './token-core.js';
import { createAuthenticationManager } from './auth.js';

class MultiAuthManager {
  private config: MultiAuthConfig;
  private validAuthTypes: string[];
  private permanentTokensSet: Set<string>;

  constructor(config: MultiAuthConfig) {
    this.config = config;
    this.permanentTokensSet = new Set(config.permanentTokens || []);

    const detection = detectAuthConfiguration(config);
    this.validAuthTypes = detection.valid.sort((a, b) => {
      // Порядок по возрастанию CPU нагрузки
      const cpuOrder = {
        'permanentTokens': 1,
        'pat': 2,
        'basic': 3,
        'jwtToken': 4,
        'oauth2': 5
      };
      return cpuOrder[a] - cpuOrder[b];
    });

    console.log(`Initialized auth with types: ${this.validAuthTypes.join(', ')}`);
  }

  /**
   * Проверка авторизации в порядке возрастания CPU нагрузки
   */
  async authenticateToken(token: string): Promise<AuthResult> {
    if (!token) {
      return { success: false, error: 'Token not provided' };
    }

    for (const authType of this.validAuthTypes) {
      try {
        const result = await this.checkAuthType(authType, token);
        if (result.success) {
          return { ...result, authType };
        }
      } catch (error) {
        // Логируем ошибку, но продолжаем проверку следующих типов
        console.warn(`Auth type ${authType} failed:`, error.message);
      }
    }

    return { success: false, error: 'Authentication failed for all configured methods' };
  }

  private async checkAuthType(authType: string, token: string): Promise<AuthResult> {
    switch (authType) {
      case 'permanentTokens':
        return this.checkPermanentToken(token);

      case 'pat':
        return this.checkPATToken(token);

      case 'basic':
        return this.checkBasicAuth(token);

      case 'jwtToken':
        return this.checkJWTToken(token);

      case 'oauth2':
        return this.checkOAuth2Token(token);

      default:
        return { success: false, error: `Unknown auth type: ${authType}` };
    }
  }

  private checkPermanentToken(token: string): AuthResult {
    if (this.permanentTokensSet.has(token)) {
      return { success: true, tokenType: 'permanent' };
    }
    return { success: false, error: 'Not a permanent token' };
  }

  private checkPATToken(token: string): AuthResult {
    // Простая проверка формата PAT токена
    if (token.startsWith('ATATT') && token.length > 20) {
      return { success: true, tokenType: 'pat', token };
    }
    return { success: false, error: 'Invalid PAT token format' };
  }

  private checkBasicAuth(token: string): AuthResult {
    try {
      // Ожидаем base64 encoded "username:password"
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [username, password] = decoded.split(':');

      if (username === this.config.basic.username &&
          password === this.config.basic.password) {
        return { success: true, tokenType: 'basic', username };
      }
      return { success: false, error: 'Invalid credentials' };
    } catch (error) {
      return { success: false, error: 'Invalid basic auth format' };
    }
  }

  private checkJWTToken(token: string): AuthResult {
    const checkResult = checkToken({ token });
    if (checkResult.errorReason) {
      return { success: false, error: checkResult.errorReason };
    }
    return {
      success: true,
      tokenType: 'jwt',
      payload: checkResult.payload
    };
  }

  private async checkOAuth2Token(token: string): Promise<AuthResult> {
    try {
      // Проверяем формат Bearer токена
      if (!token.startsWith('Bearer ')) {
        return { success: false, error: 'OAuth2 token must start with Bearer' };
      }

      const accessToken = token.replace('Bearer ', '');

      // Простая проверка, что токен похож на OAuth2 access token
      if (accessToken.length < 10) {
        return { success: false, error: 'OAuth2 token too short' };
      }

      // В реальной реализации здесь была бы проверка токена через API
      // или валидация по introspection endpoint

      return { success: true, tokenType: 'oauth2', accessToken };
    } catch (error) {
      return { success: false, error: `OAuth2 validation failed: ${error.message}` };
    }
  }

  getConfiguredAuthTypes(): string[] {
    return this.validAuthTypes;
  }

  isAuthTypeConfigured(authType: string): boolean {
    return this.validAuthTypes.includes(authType);
  }
}

interface AuthResult {
  success: boolean;
  error?: string;
  authType?: string;
  tokenType?: string;
  token?: string;
  username?: string;
  accessToken?: string;
  payload?: any;
}

export { MultiAuthManager, AuthDetectionResult, AuthResult };
```

## Middleware для Express

```typescript
import { Request, Response, NextFunction } from 'express';

export function createMultiAuthMiddleware(authManager: MultiAuthManager) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Извлекаем токен из разных источников
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    try {
      const authResult = await authManager.authenticateToken(token);

      if (!authResult.success) {
        return res.status(401).json({
          error: 'Authentication failed',
          details: authResult.error
        });
      }

      // Добавляем информацию об авторизации к запросу
      (req as any).auth = authResult;
      next();

    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({ error: 'Internal authentication error' });
    }
  };
}

function extractToken(req: Request): string | null {
  // 1. Authorization header (Bearer токен или простой токен)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/, '');
  }

  // 2. Query parameter
  const queryToken = req.query.token as string;
  if (queryToken) {
    return queryToken;
  }

  // 3. Custom header
  const customToken = req.headers['x-auth-token'] as string;
  if (customToken) {
    return customToken;
  }

  return null;
}
```

## Инициализация системы

```typescript
import { appConfig } from './config.js';

// Инициализация с текущей конфигурацией fa-mcp-sdk
function initializeAuth() {
  const { auth } = appConfig.webServer;

  console.log('Auth system status:');
  console.log('- enabled:', auth.enabled);
  console.log('- permanentServerTokens:', auth.permanentServerTokens.length, 'tokens');
  console.log('- jwtToken configured:', !!auth.jwtToken.encryptKey);
  console.log('- basic configured:', !!(auth.basic?.username && auth.basic?.password));
  console.log('- pat configured:', !!auth.pat);
  console.log('- oauth2 configured:', !!(auth.oauth2?.clientId && auth.oauth2?.clientSecret));

  const validTypes = detectValidAuthTypes(auth);
  console.log('Valid auth types (priority order):', validTypes);

  return { auth, validTypes };
}

// Использование
const authManager = initializeAuth();
export const authMiddleware = createMultiAuthMiddleware(authManager);
```

## Пример использования в приложении

```typescript
import express from 'express';
import { authMiddleware } from './auth-system.js';

const app = express();

// Публичные маршруты (без авторизации)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Защищенные маршруты
app.use('/api', authMiddleware);

app.get('/api/protected', (req, res) => {
  const authInfo = (req as any).auth;
  res.json({
    message: 'Access granted',
    authType: authInfo.authType,
    tokenType: authInfo.tokenType
  });
});

// Диагностический маршрут для проверки авторизации
app.get('/api/auth-info', (req, res) => {
  const authInfo = (req as any).auth;
  res.json({
    authenticated: true,
    authType: authInfo.authType,
    tokenType: authInfo.tokenType,
    username: authInfo.username
  });
});
```

## Переменные окружения и конфигурация

### config/default.yaml
```yaml
webServer:
  auth:
    enabled: true  # Включить аутентификацию

    # ✅ Уже работает
    permanentServerTokens:
      - "server-token-123"
      - "dev-token-456"

    # ✅ Уже работает
    jwtToken:
      encryptKey: "your-256-bit-symmetric-key"
      checkMCPName: true

    # ⚠️ Раскомментировать после реализации
    basic:
      username: "admin"
      password: "secret123"

    # ⚠️ Раскомментировать после реализации
    pat: "ATATT3xFfGF0..."

    # ⚠️ Раскомментировать после реализации
    oauth2:
      type: "oauth2"
      clientId: "ari:cloud:ecosystem::app/..."
      clientSecret: "your-client-secret"
      accessToken: "your-access-token"
      refreshToken: "your-refresh-token"
      redirectUri: "https://yourapp.com/oauth/callback"
```


## Резюме интеграции

### ✅ Уже работает (можно использовать сейчас)
- **permanentServerTokens** - статические серверные токены, проверка O(1)
- **jwtToken** - JWT с симметричным шифрованием, полная реализация в `token-core.ts`
- **Публичные запросы** - система для публичных MCP requests (resources/list, prompts/list)
- **Middleware инфраструктура** - `authTokenMW`, `createConditionalAuthMiddleware`

### ⚠️ Нужна реализация (типы готовы)
- **pat** - PersonalAccessToken, простая проверка формата
- **basic** - Basic Authentication, base64 декодирование и сравнение
- **oauth2** - OAuth2 токены, валидация через introspection endpoint

### 🔄 Порядок реализации
1. **Фаза 1** - Добавить `getMultiAuthError()` функцию в `token-auth.ts`
2. **Фаза 2** - Реализовать проверки для pat, basic, oauth2 в `checkAuthType()`
3. **Фаза 3** - Обновить `authTokenMW` для поддержки новых типов
4. **Фаза 4** - Раскомментировать секции в `default.yaml` и протестировать

### 🧩 Архитектурные преимущества
- **Обратная совместимость** - существующие JWT приложения продолжат работать
- **Постепенная миграция** - можно включать новые типы по одному
- **Переиспользование кода** - `checkToken()` остается без изменений
- **Оптимизация производительности** - проверки в порядке возрастания CPU нагрузки
