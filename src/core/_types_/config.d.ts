import { TFileLogLevel } from 'af-logger-ts';
import { IAFDatabasesConfig } from 'af-db-ts';
import { IAFConsulConfig, IAccessPoints } from 'af-consul-ts';
import { IADConfig } from './active-directory-config.js';


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

export interface AppConfig extends IADConfig,
  ILoggerConfig,
  IAFDatabasesConfig,
  IWebServerConfig,
  IMCPConfig,
  ISwaggerConfig,
  IConsulConfig {

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
}

declare module 'config' {
  const config: Partial<AppConfig>;
  export = config;
}
