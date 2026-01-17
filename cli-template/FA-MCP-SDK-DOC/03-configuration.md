# Configuration, Cache, and Database

## Configuration

### appConfig Access

```typescript
import { appConfig } from 'fa-mcp-sdk';

const port = appConfig.webServer.port;
const dbEnabled = appConfig.isMainDBUsed;
const transport = appConfig.mcp.transportType; // 'stdio' | 'http'
```

### Service Identification

| Variable | Source | Usage |
|----------|--------|-------|
| `appConfig.name` | `SERVICE_NAME` env or `package.json.name` | Consul, JWT, logs, MCP server ID |
| `appConfig.shortName` | name without "mcp" | Cache key prefix |
| `appConfig.productName` | `PRODUCT_NAME` env or `package.json.productName` | Swagger title, UI header |

### config/default.yaml

```yaml
accessPoints:
  myService:
    title: 'Remote service'
    host: <host>
    port: 9999
    token: '***'
    noConsul: true
    consulServiceName: <name>

cache:
  ttlSeconds: 300
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
        host: ''  # Empty = DB disabled
        port: 5432
        database: <database>
        user: <user>
        password: <password>

logger:
  level: info
  useFileLogger: {{logger.useFileLogger}}
  dir: '{{logger.dir}}'

mcp:
  transportType: http  # stdio | http
  toolAnswerAs: text   # text | structuredContent
  rateLimit:
    maxRequests: 100
    windowMs: 60000

swagger:
  servers:
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

## Cache

```typescript
import { getCache } from 'fa-mcp-sdk';

const cache = getCache();  // Default options
const cache = getCache({ ttlSeconds: 600, maxItems: 5000 });

// Methods
cache.set('key', value, ttlSeconds?);
cache.get<T>('key');
cache.has('key');
cache.del('key');
cache.take<T>('key');              // Get and delete
cache.mget<T>(['k1', 'k2']);
cache.mset([{ key: 'a', val: 1 }, { key: 'b', val: 2, ttl: 600 }]);
cache.keys();
cache.flush();
cache.ttl('key', seconds);         // Update TTL
cache.getTtl('key');
cache.getStats();                  // { hitRate, keys, vsize }
cache.close();

// Get-or-set pattern
const data = await cache.getOrSet('key', async () => await fetchData(), 3600);
```

## Database Integration

To disable the use of the database, you need to set appConfig.db.postgres.dbs.main.host to an empty value.
In this case, when the configuration is formed, appConfig.isMainDBUsed is set to false.


If you enable database support (`isMainDBUsed: true` in config):

```typescript
import { queryMAIN, execMAIN, oneRowMAIN, queryRsMAIN, checkMainDB } from 'fa-mcp-sdk';

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
