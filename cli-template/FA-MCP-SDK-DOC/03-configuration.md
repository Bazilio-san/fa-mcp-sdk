# Configuration, Cache, and Database

## Configuration Management

### Using `appConfig`

Access configuration in your code:

```typescript
import { appConfig } from 'fa-mcp-sdk';

// Access configuration values
const serverPort = appConfig.webServer.port;
const dbEnabled = appConfig.isMainDBUsed;
const transport = appConfig.mcp.transportType; // 'stdio' | 'http'
```

### Service Identification

The SDK uses two primary identifiers for the service:

#### SERVICE_NAME → `appConfig.name`

**Formation:**
```
process.env.SERVICE_NAME || package.json.name
```

A derivative value `appConfig.shortName` is also created by removing "mcp" from the name:
```typescript
shortName = name.replace(/[\s\-]*\bmcp\b[\s\-]*/ig, '');
// Example: "my-mcp-service" → "my-service"
```

**Usage locations:**

| Component    | Property              | Purpose                                 |
|--------------|-----------------------|-----------------------------------------|
| Consul       | `consul.service.name` | Service registration in Consul          |
| MCP Server   | Server name           | MCP protocol server identifier          |
| Logger       | File prefix           | Log file naming (`<name>.log`)          |
| JWT Auth     | `expectedService`     | Token validation - checks service claim |
| Admin API    | `serviceName`         | Service identification in API responses |
| MCP Resource | `project://id`        | Returns service identifier              |
| Cache        | `keyPrefix`           | Uses `shortName` for cache key prefixes |
| PM2          | Process name          | `<name>[--<SERVICE_INSTANCE>]`          |

#### PRODUCT_NAME → `appConfig.productName`

**Formation:**
```
process.env.PRODUCT_NAME || package.json.productName
```

This is the human-readable display name for the service.

**Usage locations:**

| Component       | Purpose                               |
|-----------------|---------------------------------------|
| OpenAPI/Swagger | API title in documentation            |
| Home page       | Service title in web UI header        |
| Server startup  | Displayed in console startup message  |
| MCP Resource    | `project://name` returns product name |

#### Environment Variables

Set these in `.env` file to override `package.json` values:

```bash
# Service identifier (technical name)
SERVICE_NAME=my-mcp-service

# Human-readable display name
PRODUCT_NAME=My MCP Service
```

### Configuration Files

**`config/default.yaml`** - Base configuration:
```yaml
accessPoints:
  myService:
    title: 'My remote service'
    host: <host>
    port: 9999
    token: '***'
    noConsul: true # Use if the service developers do not provide registration in consul
    consulServiceName: <consulServiceName>

# --------------------------------------------------
# CACHING Reduces API calls by caching responses
# --------------------------------------------------
cache:
   # Default Cache TTL in seconds
   ttlSeconds: 300
   # Default maximum number of cached items
   maxItems: 1000

consul:
   check:
      interval: '10s'
      timeout: '5s'
      deregistercriticalserviceafter: '3m'
   agent:
      # Credentials for getting information about services in the DEV DC
      dev:
         dc: '{{consul.agent.dev.dc}}'
         host: '{{consul.agent.dev.host}}'
         port: 443
         secure: true
         # Token for getting information about DEV services
         token: '***'
      # Credentials for getting information about services in the PROD DC
      prd:
         dc: '{{consul.agent.prd.dc}}'
         host: '{{consul.agent.prd.host}}'
         port: 443
         secure: true
         # Token for obtaining information about PROD services
         token: '***'
      # Credentials for registering the service with Consul
      reg:
         # The host of the consul agent where the service will be registered. If not specified, the server on which the service is running is used
         host: null
         port: 8500
         secure: false
         # Token for registering the service in the consul agent
         token: '***'
   service:
      enable: {{consul.service.enable}} # true - Allows registration of the service with the consul
      name: <name> # <name> will be replaced by <package.json>.name at initialization
      instance: '{{SERVICE_INSTANCE}}' # This value will be specified as a suffix in the id of the service
      version: <version> # <version> will be replaced by <package.json>.version at initialization
      description: <description> # <description> will be replaced by <package.json>.description at initialization
      tags: [] # If null or empty array - Will be pulled up from package.keywords at initialization
      meta:
         # "Home" page link template
         who: 'http://{address}:{port}/'
   envCode: # Used to generate the service ID
      prod: {{consul.envCode.prod}} # Production environment code
      dev: {{consul.envCode.dev}} # Development environment code

db:
   postgres:
      dbs:
         main:
            label: 'My Database'
            host: ''  # To exclude the use of the database, you need to set host = ''
            port: 5432
            database: <database>
            user: <user>
            password: <password>
            usedExtensions: []

logger:
   level: info
   useFileLogger: {{logger.useFileLogger}} # To use or not to use logging to a file
   # Absolute path to the folder where logs will be written. Default <proj_root>/../logs
   dir: '{{logger.dir}}'

mcp:
   transportType: http # stdio | http
   # Response format configuration.
   # - structuredContent - default - the response in result.structuredContent returns JSON
   # - text - in the response, serialized JSON is returned in result.content[0].text
   toolAnswerAs: text # text | structuredContent
   rateLimit:
      maxRequests: 100
      windowMs: 60000  # 1 minute

swagger:
   servers:  # An array of servers that will be added to swagger docs
      # - url: http://localhost:9020
      #   description: "Development server (localhost)"
      # - url: http://0.0.0.0:9020
      #   description: "Development server (all interfaces)"
      # - url: http://<prod_server_host_or_ip>:{{port}}
      #   description: "PROD server"
      - url: https://{{mcp.domain}}
        description: "PROD server"

uiColor:
   # Font color of the header and a number of interface elements on the HOME page
   primary: '#0f65dc'

webServer:
   host: '0.0.0.0'
   port: {{port}}
   # array of hosts that CORS skips
   originHosts: ['localhost', '0.0.0.0']
   # Authentication is configured here only when accessing the MCP server
   # Authentication in services that enable tools, resources, and prompts
   # is implemented more deeply. To do this, you need to use the information passed in HTTP headers
   # You can also use a custom authorization function
   auth:
      enabled: false # Enables/disables authorization
      # ========================================================================
      # PERMANENT SERVER TOKENS
      # Static tokens for server-to-server communication
      # CPU cost: O(1) - fastest authentication method
      #
      # To enable this authentication, you need to set auth.enabled = true
      # and set one token of at least 20 characters in length
      # ========================================================================
      permanentServerTokens: [ ] # Add your server tokens here: ['token1', 'token2']

      # ========================================================================
      # JWT TOKEN WITH SYMMETRIC ENCRYPTION
      # Custom JWT tokens with AES-256 encryption
      # CPU cost: Medium - decryption + JSON parsing
      #
      # To enable this authentication, you need to set auth.enabled = true and set
      # encryptKey to at least 20 characters
      # ========================================================================
      jwtToken:
         # Symmetric encryption key to generate a token for this MCP (minimum 8 chars)
         encryptKey: '***'
         # If webServer.auth.enabled and the parameter true, the service name and the service specified in the token will be checked
         checkMCPName: true

      # ========================================================================
      # Basic Authentication - Base64 encoded username:password
      # CPU cost: Medium - Base64 decoding + string comparison
      # To enable this authentication, you need to set auth.enabled = true
      # and set username and password to valid values
      # ========================================================================
      basic:
         username: ''
         password: '***'
```

**`config/local.yaml`** - local overrides. Usually contains secrets.

---

## Cache Management

### `getCache(options?): CacheManager`

Get or create a global cache instance for your MCP server.

```typescript
import { getCache, CacheManager } from 'fa-mcp-sdk';

// Create default cache instance
const cache = getCache();

// Create cache with custom options
const customCache = getCache({
  ttlSeconds: 600,    // Default TTL: 10 minutes
  maxItems: 5000,     // Max cached items
  checkPeriod: 300,   // Cleanup interval in seconds
  verbose: true       // Enable debug logging
});
```

### Cache Methods

The `CacheManager` provides the following methods:

| Method | Description | Example |
|--------|-------------|---------|
| `get<T>(key)` | Get value from cache | `const user = cache.get<User>('user:123');` |
| `set<T>(key, value, ttl?)` | Set value in cache | `cache.set('user:123', userData, 300);` |
| `has(key)` | Check if key exists | `if (cache.has('user:123')) { ... }` |
| `del(key)` | Delete key from cache | `cache.del('user:123');` |
| `take<T>(key)` | Get and delete (single use) | `const otp = cache.take<string>('otp:123');` |
| `mget<T>(keys[])` | Get multiple values | `const users = cache.mget(['user:1', 'user:2']);` |
| `mset(items[])` | Set multiple values | `cache.mset([{key: 'a', val: 1}, {key: 'b', val: 2}]);` |
| `getOrSet<T>(key, factory, ttl?)` | Get or compute value | `const data = await cache.getOrSet('key', () => fetchData());` |
| `keys()` | List all keys | `const allKeys = cache.keys();` |
| `flush()` | Clear all entries | `cache.flush();` |
| `ttl(key, seconds)` | Update key TTL | `cache.ttl('user:123', 600);` |
| `getTtl(key)` | Get remaining TTL | `const remaining = cache.getTtl('user:123');` |
| `getStats()` | Get cache statistics | `const stats = cache.getStats();` |
| `close()` | Close cache resources | `cache.close();` |

### Usage Examples

```typescript
import { getCache } from 'fa-mcp-sdk';

const cache = getCache();

// Basic caching
cache.set('user:123', { name: 'John', email: 'john@example.com' });
const user = cache.get<User>('user:123');

// Cache with TTL (time to live)
cache.set('session:abc', sessionData, 1800); // 30 minutes

// Single-use values (OTP, tokens)
cache.set('otp:user123', '123456', 300);
const otp = cache.take('otp:user123'); // Gets and deletes

// Get-or-set pattern
const expensiveData = await cache.getOrSet(
  'computation:key',
  async () => {
    // This function runs only on cache miss
    return await performExpensiveOperation();
  },
  3600 // Cache for 1 hour
);

// Batch operations
const userData = cache.mget(['user:1', 'user:2', 'user:3']);
cache.mset([
  { key: 'user:1', val: user1Data },
  { key: 'user:2', val: user2Data, ttl: 600 }
]);

// Cache monitoring
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Keys: ${stats.keys}, Memory: ${stats.vsize} bytes`);
```

---

## Database Integration

To disable the use of the database, you need to set appConfig.db.postgres.dbs.main.host to an empty value.
In this case, when the configuration is formed, appConfig.isMainDBUsed is set to false.


If you enable database support (`isMainDBUsed: true` in config):

```typescript
import {
  queryMAIN,
  execMAIN,
  oneRowMAIN,
  getMainDBConnectionStatus
} from 'fa-mcp-sdk';

// Check database connection. If there is no connection, the application stops
await checkMainDB();

// queryMAIN - the main function of executing SQL queries to the main database

// Function Signature:
const queryMAIN = async <R extends QueryResultRow = any> (
        arg: string | IQueryPgArgsCOptional,
        sqlValues?: any[],
        throwError = false,
): Promise<QueryResult<R> | undefined> {...}

// Types used:
export interface IQueryPgArgs {
   connectionId: string,
   poolConfig?: PoolConfig & IDbOptionsPg,
   client?: IPoolPg,
   sqlText: string,
   sqlValues?: any[],
   throwError?: boolean,
   prefix?: string,
   registerTypesFunctions?: IRegisterTypeFn[],
}
export interface IQueryPgArgsCOptional extends Omit<IQueryPgArgs, 'connectionId'> {
   connectionId?: string
}

// Examples of use
const users1 = await queryMAIN('SELECT * FROM users WHERE active = $1', [true]);
// Alternative use case
const users2 = await queryMAIN({ sqlText: 'SELECT * FROM users WHERE active = $1', sqlValues: [true] });


// execMAIN - execute SQL commands without returning result set
// Function Signature:
const execMAIN = async (
  arg: string | IQueryPgArgsCOptional,
): Promise<number | undefined> {...}

// Examples:
await execMAIN({ sqlText: 'INSERT INTO logs (message, created_at) VALUES ($1, $2)', sqlValues: ['Server started', new Date()] });
await execMAIN({ sqlText: 'UPDATE users SET active = $1 WHERE id = $2', sqlValues: [false, userId] });

// queryRsMAIN - execute SQL and return rows array directly
// Function Signature:
const queryRsMAIN = async <R extends QueryResultRow = any> (
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<R[] | undefined> {...}

// Example:
const users = await queryRsMAIN<User>('SELECT * FROM users WHERE active = $1', [true]);

// oneRowMAIN - execute SQL and return single row
// Function Signature:
const oneRowMAIN = async <R extends QueryResultRow = any> (
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<R | undefined> {...}

// Example:
const user = await oneRowMAIN<User>('SELECT * FROM users WHERE id = $1', [userId]);

// getMainDBConnectionStatus - check database connection status
// Function Signature:
const getMainDBConnectionStatus = async (): Promise<string> {...}

// Possible return values: 'connected' | 'disconnected' | 'error' | 'db_not_used'
const status = await getMainDBConnectionStatus();

// checkMainDB - verify database connectivity (stops application if failed)
// Function Signature:
const checkMainDB = async (): Promise<void> {...}

// Example:
await checkMainDB(); // Throws or exits process if DB connection fails

// getInsertSqlMAIN - generate INSERT SQL statement
// Function Signature:
const getInsertSqlMAIN = async <U extends TDBRecord = TDBRecord> (arg: {
  commonSchemaAndTable: string,
  recordset: TRecordSet<U>,
  excludeFromInsert?: string[],
  addOutputInserted?: boolean,
  isErrorOnConflict?: boolean,
  keepSerialFields?: boolean,
}): Promise<string> {...}

// Example:
const insertSql = await getInsertSqlMAIN({
  commonSchemaAndTable: 'public.users',
  recordset: [{ name: 'John', email: 'john@example.com' }],
  addOutputInserted: true
});

// getMergeSqlMAIN - generate UPSERT (INSERT...ON CONFLICT) SQL statement
// Function Signature:
const getMergeSqlMAIN = async <U extends TDBRecord = TDBRecord> (arg: {
  commonSchemaAndTable: string,
  recordset: TRecordSet<U>,
  conflictFields?: string[],
  omitFields?: string[],
  updateFields?: string[],
  fieldsExcludedFromUpdatePart?: string[],
  noUpdateIfNull?: boolean,
  mergeCorrection?: (_sql: string) => string,
  returning?: string,
}): Promise<string> {...}

// Example:
const mergeSql = await getMergeSqlMAIN({
  commonSchemaAndTable: 'public.users',
  recordset: [{ id: 1, name: 'John Updated', email: 'john@example.com' }],
  conflictFields: ['email'],
  returning: '*'
});

// mergeByBatch - execute merge operations in batches
// Function Signature:
const mergeByBatch = async <U extends TDBRecord = TDBRecord> (arg: {
  recordset: TRecordSet<U>,
  getMergeSqlFn: Function
  batchSize?: number
}): Promise<any[]> {...}

// Example:
const results = await mergeByBatch({
  recordset: largeDataSet,
  getMergeSqlFn: (batch) => getMergeSqlMAIN({
    commonSchemaAndTable: 'public.users',
    recordset: batch
  }),
  batchSize: 500
});
```
