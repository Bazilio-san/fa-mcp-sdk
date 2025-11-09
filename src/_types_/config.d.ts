import { TFileLogLevel } from 'af-logger-ts';
import { IAFDatabasesConfig } from 'af-db-ts';
import { IAFConsulConfig } from 'af-consul-ts';


// Logging configuration
interface ILoggerConfig {
  logger: {
    level: TFileLogLevel;
    useFileLogger: boolean;
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
      tokenEncryptKey: string,
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

export interface AppConfig extends ILoggerConfig,
  IAFDatabasesConfig,
  IWebServerConfig,
  IMCPConfig,
  ISwaggerConfig,
  IConsulConfig {
  // Package metadata (enriched from package.json)
  name: string;
  shortName: string; // name without 'mcp'
  repo: string;
  version: string;
  productName: string,
  description: string;
  consul: IAFConsulConfig & {
    envCode: {
      prod: string; // Required - product contour code
      dev: string; // Required - code of the development circuit
    };
  },
  uiColor: {
    primary: string; // Interface color
  }
}

declare module 'config' {
  const config: Partial<AppConfig>;
  export = config;
}
