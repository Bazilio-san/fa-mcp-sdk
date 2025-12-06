import { TFileLogLevel } from 'af-logger-ts';
import { IAFDatabasesConfig } from 'af-db-ts';
import { IAFConsulConfig, IAccessPoints } from 'af-consul-ts';
import { IADConfig } from './active-directory-config.js';

// JIRA Authentication types
interface IBasicAuth {
  username?: string;
  password?: string;
}

interface IOAuth2Auth {
  type: 'oauth2';
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken?: string;
  redirectUri?: string;
}

// Tool configuration
interface IToolsConfig {
  include: 'ALL' | string[];
  exclude: string[];
}

// User resolution configuration
interface IUserLookupConfig {
  enabled: boolean;
  serviceUrl: string;
  timeoutMs?: number;
}

// JIRA configuration
interface IJiraConfig {
  url: string;
  apiVersion: 2 | 3;
  restPath: string; // /rest/api/<2|3>
  origin: string;
  auth?: {
    basic?: IBasicAuth;
    pat?: string;
    oauth2?: IOAuth2Auth;
  };
  fieldId: {
    epicLink: string;
    epicName: string;
    storyPoints: string;
  };
  usedInstruments?: IToolsConfig;
  userLookup?: IUserLookupConfig;
}

// SSL/TLS configuration
interface ISslConfig {
  rejectUnauthorized: boolean;
}

// User substitution configuration
interface ISubstitutionConfig {
  httpHeader?: string; // HTTP header name to use with impersonate plugin
  loginIfNoHeader?: string; // Optional login as this user if no header is provided. Used for caching priorities
  jira?: Record<string, string>; // Mapping from original user to substitute user
}


// Logging configuration
interface ILoggerConfig {
  logger: {
    level: TFileLogLevel;
    useFileLogger: boolean;
    dir?: string; // Directory for log files (if useFileLogger is true)
  }
}

interface IWebServerConfig {
  webServer: {
    host: string,
    port: number,
    originHosts: string[],
    auth: {
      enabled: boolean,
      permanentServerTokens: string[],
      token: {
        encryptKey: string,
        checkMCPName: boolean,
      }
    },
  }
}

interface IMCPConfig {
  mcp: {
    rateLimit: {
      maxRequests: number;
      windowMs: number;
    };
    toolAnswerAs: 'text' | 'structuredContent'
    transportType: 'stdio' | 'http';
  }
}

interface ISwaggerConfig {
  swagger: {
    servers?: {
      url: string,
      description: string,
    }[], // An array of servers that will be added to swagger docs
  }
}

interface ICacheConfig {
  cache: {
    ttlSeconds: 300, // Cache TTL in seconds
    maxItems: 1000, // Maximum number of cached items
  }
}

export interface AppConfig extends IADConfig,
  ICacheConfig,
  IConsulConfig,
  ILoggerConfig,
  IAFDatabasesConfig,
  IWebServerConfig,
  IMCPConfig,
  ISwaggerConfig {

  isMainDBUsed: boolean, // = !!appConfig.db.postgres?.dbs.main?.host
  // Package metadata (enriched from package.json)
  name: string;
  shortName: string; // name without 'mcp'
  repo: string;
  version: string;
  productName: string,
  description: string;

  accessPoints: IAccessPoints,
  consul: IAFConsulConfig & {
    envCode: {
      prod: string; // Production environment code
      dev: string; // Development environment code
    };
  },
  uiColor: {
    primary: string; // Font color of the header and a number of interface elements on the ABOUT page
  }

  // JIRA-specific configuration
  jira?: IJiraConfig;
  ssl?: ISslConfig;
  subst?: ISubstitutionConfig;
}

declare module 'config' {
  const config: Partial<AppConfig>;
  export = config;
}
