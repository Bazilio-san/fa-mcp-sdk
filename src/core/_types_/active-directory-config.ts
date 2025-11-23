import { ConnectionOptions } from 'node:tls';
import { EAuthStrategy } from 'ya-express-ntlm';

export interface IDcConfig {
  // An array of LDAP addresses. Addresses must start with ldap://
  /**
   ['ldap://c1.corp.com', 'ldap://c2.corp.com']
   */
  controllers: string[],
  // Service account name and password for AD requests
  username: string,
  password: string,
  default?: boolean,

  // ============= Assigned when processing the config in NTLM module ==========

  // name === domainName
  name?: string,
  // A RegExp string that is used to match a settings block by hostname.
  // Default: '^${domainName}'
  // String and not RegExp - because RegExp is not passed in node.config parameters.
  hostReSource?: string,
  hostRe?: RegExp,
}

export interface IADConfig {
  ad: {
    domains: {
      // domainName - Domain name Example: 'OFFICE'
      [domainName: string]: IDcConfig;
    }
    tlsOptions?: ConnectionOptions;
    strategy?: EAuthStrategy;
  }
}
