import { TFileLogLevel } from 'af-logger-ts';
import { IAFDatabasesConfig } from 'af-db-ts';
import { IAFConsulConfig, IAccessPoints } from 'fa-consul';
import { IADConfig } from './active-directory-config.js';


interface IWebServerConfig {
  webServer: {
    host: string,
    port: number,
    originHosts: string[],
    auth: {
      enabled: boolean,
      basic?: {
        username: string;
        password: string;
      };
      jwtToken: {
        encryptKey: string,
        checkMCPName: boolean,
      }
      permanentServerTokens: string[],
    },
    adminAuth: {
      enabled: boolean,
      type: 'permanentServerTokens' | 'basic' | 'jwtToken' | 'ntlm',
    },
  }
}

// Logging configuration
interface ILoggerConfig {
  logger: {
    level: TFileLogLevel;
    useFileLogger: boolean;
    dir?: string; // Directory for log files (if useFileLogger is true)
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

interface IAgentTesterConfig {
  agentTester?: {
    enabled: boolean;
    useAuth: boolean;
    openAi?: {
      apiKey: string;
      baseUrl?: string;
    };
    httpHeaders?: Record<string, string>;
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
  ILoggerConfig,
  IAFDatabasesConfig,
  IWebServerConfig,
  IMCPConfig,
  ISwaggerConfig,
  IAgentTesterConfig {

  isMainDBUsed: boolean, // = !!appConfig.db.postgres?.dbs.main?.host
  // Package metadata (enriched from package.json)
  name: string; // env SERVICE_NAME | <package.json>.name
  shortName: string; // name without 'mcp'
  repo: string;
  version: string;
  productName: string, // env PRODUCT_NAME | <package.json>.productName
  description: string; // <package.json>.description

  accessPoints: IAccessPoints,
  consul: IAFConsulConfig & {
    envCode: {
      prod: string; // Production environment code
      dev: string; // Development environment code
    };
  },
  uiColor: {
    primary: string; // Font color of the header and a number of interface elements on the HOME page
  }
}
