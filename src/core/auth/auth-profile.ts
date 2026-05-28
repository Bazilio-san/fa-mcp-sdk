import { appConfig } from '../bootstrap/init-config.js';

/**
 * Summary of which authentication methods are wired up on this server.
 * Surfaced via the `use://auth` resource (standard §11.2 SHOULD).
 */
export interface IAuthProfile {
  enabled: boolean;
  schemes: string[];
  methods: string[];
  claims?: {
    issuer?: string;
    checkMCPName?: boolean;
    isCheckIP?: boolean;
  };
  headers: { authorization: string };
  httpHeadersResource: string;
}

export function collectAuthProfile(): IAuthProfile {
  const auth = appConfig.webServer?.auth;
  const methods: string[] = [];
  const schemes: Set<string> = new Set();
  if (auth?.enabled) {
    if (Array.isArray(auth.permanentServerTokens) && auth.permanentServerTokens.filter(Boolean).length > 0) {
      methods.push('permanentServerTokens');
      schemes.add('Bearer');
    }
    if (auth.jwtToken?.encryptKey) {
      methods.push('jwtToken');
      schemes.add('Bearer');
    }
    if (auth.basic?.username && auth.basic?.password) {
      methods.push('basic');
      schemes.add('Basic');
    }
  }
  if (global.__MCP_PROJECT_DATA__?.customAuthValidator) {
    methods.push('custom');
  }

  const claims: NonNullable<IAuthProfile['claims']> = {};
  const issuer = auth?.jwtToken?.issuer;
  if (issuer) {
    claims.issuer = issuer;
  }
  if (typeof auth?.jwtToken?.checkMCPName === 'boolean') {
    claims.checkMCPName = auth.jwtToken.checkMCPName;
  }
  if (typeof auth?.jwtToken?.isCheckIP === 'boolean') {
    claims.isCheckIP = auth.jwtToken.isCheckIP;
  }

  return {
    enabled: !!auth?.enabled,
    schemes: Array.from(schemes),
    methods,
    claims,
    headers: { authorization: 'Authorization: Bearer <token>' },
    httpHeadersResource: 'use://http-headers',
  };
}
