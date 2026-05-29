import { IAFDatabasesConfig } from 'af-db-ts';
import { TFileLogLevel } from 'af-logger-ts';
import { IAFConsulConfig, IAccessPoints } from 'fa-consul';

import { IADConfig } from './active-directory-config.js';

export type AdminAuthType = 'permanentServerTokens' | 'basic' | 'jwtToken' | 'ntlm';
export type AdminAuthTypeInput = AdminAuthType | 'none';

interface IWebServerConfig {
  webServer: {
    host: string;
    port: number;
    originHosts: string[];
    auth: {
      enabled: boolean;
      basic?: {
        username: string;
        password: string;
      };
      jwtToken: {
        // 'legacyAesCtr' — HS256 issue + legacy AES-CTR read (current behavior, default).
        // 'embedded'     — ES256/RS256 with built-in IdP: server auto-generates keypair on first start,
        //                  publishes JWKS, accepts oauth/token (grant_type=password).
        // 'localKey'     — ES256/RS256, public key from PEM file on disk (private key only when issuing).
        // 'remoteJwks'   — ES256/RS256 verify only; tokens issued by external IdP (Keycloak/Okta/…).
        mode?: 'legacyAesCtr' | 'embedded' | 'localKey' | 'remoteJwks';
        // HS256 secret used only by legacyAesCtr mode (kept for backward compatibility).
        encryptKey: string;
        checkMCPName: boolean;
        isCheckIP: boolean;
        issuer?: string;
        // ES256/RS256 algorithm — applies to embedded/localKey/remoteJwks. Default: ES256.
        algorithm?: 'ES256' | 'RS256';
        // Directory for embedded keypair (private.pem + public.pem). Auto-generated on first run.
        // Used only in mode=embedded. Default: ./keys
        keyStoragePath?: string;
        // Path to public key PEM (used only in mode=localKey).
        publicKeyPath?: string;
        // Path to private key PEM. Optional — when set, allows local issuance via generate-jwt.js / /gen-jwt.
        privateKeyPath?: string;
        // Remote JWKS endpoint (used only in mode=remoteJwks). e.g. https://idp.example.com/.well-known/jwks.json
        jwksUri?: string;
        // Expected `iss` claim — required match in modes embedded/localKey/remoteJwks.
        expectedIssuer?: string;
        // Expected `aud` claim — token must contain this audience. Defaults to appConfig.name.
        expectedAudience?: string;
        // JWKS in-memory cache TTL in seconds. Default: 600.
        jwksCacheTtl?: number;
        // Minimum interval (seconds) between repeat JWKS fetches when kid missing. Default: 30.
        jwksCooldown?: number;
        // Allowed clock skew (seconds) for exp/nbf checks. Default: 30. Max enforced: 60 (standard Прил. A.1).
        clockSkew?: number;
        // Default TTL (seconds) for tokens issued by embedded /oauth/token endpoint. Default: 1800.
        defaultTtl?: number;
      };
      permanentServerTokens: string[];
      //> Revocation lists — never accepted by MCP, Admin or Agent Tester
      revoked?: {
        //> Revoked JWT entries. `token` may be a full token string (legacy or exact JWT) or a `jti` value.
        jwtTokens?: Array<{ token: string; note?: string }>;
        //> Revoked usernames matched against JWT payload.user (case-insensitive)
        users?: string[];
      };
    };
    genJwtApiEnable: boolean;
    //> Standard §7.1 — POST /ct only by default. allowQueryToken=true re-enables GET /ct?t= (non-prod).
    tokenCheck?: {
      allowQueryToken?: boolean;
    };
    //> Express `trust proxy` setting (false | true | 'loopback' | number | etc.).
    //> Required when /.well-known/openid-configuration is built from X-Forwarded-* headers.
    trustProxy?: boolean | string | number;
    //> Standard §15.3 — Prometheus metrics endpoint. Opt-in. Endpoint is public (no auth) —
    //> protect via network policy / reverse proxy.
    metrics?: {
      enabled?: boolean;
      path?: string;
      includeProcessMetrics?: boolean;
    };
  };
}

// Admin panel configuration (top-level). enabled=false — panel is not mounted at all.
// authType absent / null / empty array / 'none' — panel opens without authentication
// (dev/debug convenience mode).
interface IAdminPanelConfig {
  adminPanel?: {
    enabled: boolean;
    authType?: AdminAuthTypeInput | AdminAuthTypeInput[] | null;
  };
}

// Logging configuration
interface ILoggerConfig {
  logger: {
    level: TFileLogLevel;
    useFileLogger: boolean;
    dir?: string; // Directory for log files (if useFileLogger is true)
    disableMasking?: boolean; // If true, disable built-in secret/email/URL masking (maskValuesRegEx = [])
  };
}

interface IMCPConfig {
  mcp: {
    rateLimit: {
      maxRequests: number;
      windowMs: number;
      //> Standard §14 — 'subject' counts per JWT `sub` (falls back to IP). 'ip' = legacy.
      scope?: 'subject' | 'ip';
      //> Max concurrent in-flight tools/call per subject. Default 16.
      maxConcurrentPerSubject?: number;
    };
    /**
     * Hard ceilings enforced by the HTTP transport. Standard §14 defines the defaults;
     * concrete servers MAY raise or lower them via `config/*.yaml`.
     */
    limits: {
      /** Max accepted JSON / urlencoded request body, bytes. Default 1 MiB (1_048_576). */
      maxPayloadBytes: number;
      /** Max serialized tool result, bytes. Anything above is truncated with explicit markers. */
      maxToolResultBytes: number;
      /** Per-tool execution timeout, milliseconds. */
      toolTimeoutMs: number;
    };
    transportType: 'stdio' | 'http';
    tools: {
      answerAs: 'text' | 'structuredContent';
      hideAnnotations: boolean;
    };
    /**
     * Standard §8.4 — server-side pagination for `tools/list`, `prompts/list`, `resources/list`.
     * Cursor is opaque base64(offset); page is sorted stably by `name` / `uri`.
     */
    pagination?: {
      /** Items per page. Default 100. */
      pageSize?: number;
    };
    /**
     * Standard §11.5 — optional MAY capabilities. Off by default.
     */
    resources?: {
      /** Enable `resources/subscribe` + `notifications/resources/updated`. */
      subscribeEnabled?: boolean;
      /** Enable `resources/templates/list`. */
      templatesEnabled?: boolean;
    };
    /**
     * Standard §15.2 + §8.2 — MCP `logging` capability. When enabled, the server declares
     * `logging: {}` on initialize and accepts `logging/setLevel` to throttle emissions.
     */
    logging?: {
      /** Default `true`. Set to `false` to suppress `logging` capability advertisement. */
      enabled?: boolean;
      /** Initial severity threshold. Syslog ladder; default `info`. */
      defaultLevel?: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
      /** Max serialized `data` payload, bytes. Anything above is truncated. Default 4096. */
      maxBodyBytes?: number;
    };
    /**
     * Standard §8.6 — `notifications/progress` server-side throttling.
     */
    progress?: {
      /** Minimum gap between successive progress emissions, milliseconds. Default 100 (10 events/s). */
      throttleMs?: number;
    };
    /**
     * Standard §8.2 (MAY) — `completion/complete` capability. Off by default. Even when enabled,
     * the capability is advertised only if `McpServerData.completionProvider` is also supplied.
     */
    completions?: {
      /** Default `false`. Set `true` (plus a `completionProvider`) to advertise `completions: {}`. */
      enabled?: boolean;
    };
    /**
     * Standard §8.7 (MAY) — task-augmented execution. Off by default. When enabled, the server
     * advertises the `tasks` capability and accepts the task lifecycle methods (`tasks/list`,
     * `tasks/get`, `tasks/result`, `tasks/cancel`). Individual long-running tools opt in via
     * `execution.taskSupport` in their declaration (§9.1). The default task store keeps records in
     * process memory only — it does not survive a restart.
     */
    tasks?: {
      /** Default `false`. Set `true` to advertise `tasks` capability and accept task methods. */
      enabled?: boolean;
      /**
       * Default retention of a finished task, milliseconds, measured from creation. A client may
       * request a different `ttl`; the server clamps it to `[minTtlMs ?? 0, maxTtlMs]`.
       * Default 3_600_000 (1 hour).
       */
      defaultTtlMs?: number;
      /** Lower bound a client-requested `ttl` is clamped to, milliseconds. Default 0 (no floor). */
      minTtlMs?: number;
      /** Hard upper bound on retention, milliseconds. Default 86_400_000 (24 hours). */
      maxTtlMs?: number;
      /** Recommended poll interval suggested to the client in every task object. Default 1000. */
      pollIntervalMs?: number;
      /**
       * Max number of simultaneously retained tasks across all subjects. When the cap is reached,
       * the oldest finished tasks are evicted first. Default 1000.
       */
      maxTasks?: number;
    };
    /**
     * Standard §6 (MAY) — Streamable HTTP SSE stream resumability via the `Last-Event-ID` header.
     * Off by default. When enabled, the server wires an in-memory `EventStore` into the transport
     * so a reconnecting client can replay the messages it missed. The store lives in process memory
     * only — it does not survive a restart and does not span multiple server instances.
     */
    sse?: {
      /** Default `false`. Set `true` to attach the in-memory EventStore to the Streamable HTTP transport. */
      resumability?: boolean;
      /** Max number of events retained per process for replay. Default 1000. */
      maxStoredEvents?: number;
    };
    /**
     * Debug & diagnostics. All keys are optional and disabled by default — the
     * stderr `DEBUG=mcp:*` stream keeps working independently of this section.
     */
    debug?: {
      /**
       * Absolute path to a JSON-lines file that mirrors `DEBUG=mcp:*` events
       * in a machine-parseable form. Empty / unset — file logging disabled.
       * The parent directory is created lazily on the first event.
       */
      logFile?: string;
      /**
       * When true, registers SDK-provided built-in MCP tools intended for
       * widgets and integration tests (`mcp-debug-log`, `mcp-debug-refresh`,
       * `debug-tool`). All are marked `_meta.ui.visibility: ['app']` and stay
       * hidden from the LLM — they're only callable from MCP App widgets
       * (`app.callServerTool(...)`) or from test clients. Default: false.
       */
      builtinTools?: boolean;
    };
  };
}

interface ISwaggerConfig {
  swagger: {
    servers?: {
      url: string;
      description: string;
    }[]; // An array of servers that will be added to swagger docs
  };
}

interface IAgentTesterConfig {
  agentTester?: {
    enabled: boolean;
    showFooterLink?: boolean; // default: true; false — hides footer link without disabling tester
    useAuth: boolean; // true — protect Agent Tester with full multi-auth (permanentTokens/basic/JWT/custom); browser users see a login dialog, headless clients pass Authorization header
    sessionTtlMs?: number; // Session lifetime in milliseconds for browser login sessions. Default: 28_800_000 (8h). Applies only when useAuth is true.
    tokenTTLSec?: number; // JWT TTL (seconds) for tokens auto-issued via /agent-tester/api/auth-token. Default: 1800 (30 min).
    logJson?: boolean; // true — emit structured JSON events (tool_call, tool_result, llm_response, response) to stdout during agent execution
    openAi?: {
      apiKey: string;
      baseURL?: string;
      exposeToClient?: boolean; // default false; when true — apiKey/baseURL sent to Agent Tester UI as defaults
    };
    httpHeaders?: Record<string, string>;
  };
}

interface IHomePageConfig {
  homePage?: {
    helpLink?: {
      href: string;
      text?: string; // default: "Help"
    };
    maintainer?: {
      href: string;
      text?: string; // default: "Support"
    };
  };
}

interface ICacheConfig {
  cache: {
    ttlSeconds: 300; // Cache TTL in seconds
    maxItems: 1000; // Maximum number of cached items
  };
}

export interface AppConfig
  extends
    IADConfig,
    ICacheConfig,
    ILoggerConfig,
    IAFDatabasesConfig,
    IWebServerConfig,
    IAdminPanelConfig,
    IMCPConfig,
    ISwaggerConfig,
    IAgentTesterConfig,
    IHomePageConfig {
  isMainDBUsed: boolean; // = !!appConfig.db.postgres?.dbs.main?.host
  // Package metadata (enriched from package.json)
  name: string; // env SERVICE_NAME | <package.json>.name
  shortName: string; // name without 'mcp'
  repo: string;
  version: string;
  sdkVersion: string; // fa-mcp-sdk package version (read from SDK's own package.json)
  productName: string; // env PRODUCT_NAME | <package.json>.productName
  description: string; // <package.json>.description

  accessPoints: IAccessPoints;
  consul: IAFConsulConfig & {
    envCode: {
      prod: string; // Production environment code
      dev: string; // Development environment code
    };
  };
  uiColor: {
    primary: string; // Font color of the header and a number of interface elements on the HOME page
  };
}
