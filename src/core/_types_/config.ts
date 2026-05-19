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
        encryptKey: string;
        checkMCPName: boolean;
        isCheckIP: boolean;
        issuer?: string;
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
    };
    transportType: 'stdio' | 'http';
    tools: {
      answerAs: 'text' | 'structuredContent';
      hideAnnotations: boolean;
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
