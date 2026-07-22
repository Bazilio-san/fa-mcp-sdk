import { appConfig } from '../bootstrap/init-config.js';

import { getJwtRuntimeConfig } from './key-resolver.js';

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
    subjectClaim?: 'sub';
    userClaim?: string;
  };
  jwt?: {
    mode: 'legacyAesCtr' | 'embedded' | 'localKey' | 'remoteJwks';
    algorithm?: 'ES256' | 'RS256' | 'HS256';
    expectedIssuer?: string;
    expectedAudience?: string;
    jwksUri?: string;
  };
  discovery?: {
    protectedResource?: string;
    openidConfiguration?: string;
    jwks?: string;
    token?: string;
  };
  oauth?: {
    resourceUrl?: string;
    authorizationServers: string[];
    advertisedScopes: string[];
    resourceDocumentationUrl?: string;
  };
  requiredScopes?: {
    tools: Record<string, string[]>;
    prompts: Record<string, string[]>;
    resources: Record<string, string[]>;
  };
  defaultReadScopes?: string[];
  headers: { authorization: string };
  httpHeadersResource: string;
}

export function collectAuthProfile(): IAuthProfile {
  const auth = appConfig.webServer?.auth;
  const jwtRt = getJwtRuntimeConfig();
  const methods: string[] = [];
  const schemes: Set<string> = new Set();
  if (auth?.enabled) {
    if (Array.isArray(auth.permanentServerTokens) && auth.permanentServerTokens.filter(Boolean).length > 0) {
      methods.push('permanentServerTokens');
      schemes.add('Bearer');
    }
    if (jwtRt.mode !== 'legacyAesCtr' || (auth.jwtToken?.encryptKey && auth.jwtToken.encryptKey !== '***')) {
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
  if (jwtRt.mode !== 'legacyAesCtr') {
    claims.subjectClaim = 'sub';
    claims.userClaim = jwtRt.userClaim || 'sub';
  }

  const toList = (value: unknown): string[] => {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return Array.from(new Set(entries.map((entry) => String(entry).trim()).filter(Boolean)));
  };
  const oauthConfig = auth?.oauth;
  const oauth: NonNullable<IAuthProfile['oauth']> = {
    authorizationServers: toList(oauthConfig?.authorizationServers),
    advertisedScopes: toList(oauthConfig?.advertisedScopes),
    ...(String(oauthConfig?.resourceUrl ?? '').trim() ? { resourceUrl: String(oauthConfig?.resourceUrl).trim() } : {}),
    ...(String(oauthConfig?.resourceDocumentationUrl ?? '').trim()
      ? { resourceDocumentationUrl: String(oauthConfig?.resourceDocumentationUrl).trim() }
      : {}),
  };

  const jwt: NonNullable<IAuthProfile['jwt']> = {
    mode: jwtRt.mode,
    algorithm: jwtRt.mode === 'legacyAesCtr' ? 'HS256' : jwtRt.algorithm,
  };
  if (jwtRt.expectedIssuer) {
    jwt.expectedIssuer = jwtRt.expectedIssuer;
  }
  if (jwtRt.expectedAudience) {
    jwt.expectedAudience = jwtRt.expectedAudience;
  }
  if (jwtRt.jwksUri) {
    jwt.jwksUri = jwtRt.jwksUri;
  }

  const discovery: NonNullable<IAuthProfile['discovery']> = {};
  if (jwtRt.mode !== 'legacyAesCtr') {
    discovery.protectedResource = '/.well-known/oauth-protected-resource';
    if (jwtRt.mode === 'embedded' || jwtRt.mode === 'localKey') {
      discovery.openidConfiguration = '/.well-known/openid-configuration';
      discovery.jwks = '/.well-known/jwks.json';
      discovery.token = '/oauth/token';
    }
  }

  // Aggregate requiredScopes declared on customResources / customPrompts / tools so
  // clients (and use://auth consumers) can introspect server-side §7.5 enforcement.
  const requiredScopes: NonNullable<IAuthProfile['requiredScopes']> = {
    tools: {},
    prompts: {},
    resources: {},
  };
  const data = global.__MCP_PROJECT_DATA__;
  const tools = Array.isArray(data?.tools) ? data.tools : [];
  for (const t of tools as any[]) {
    const scopes = t?._meta?.requiredScopes ?? t?.requiredScopes;
    if (Array.isArray(scopes) && scopes.length > 0 && typeof t?.name === 'string') {
      requiredScopes.tools[t.name] = scopes as string[];
    }
  }
  const prompts = Array.isArray(data?.customPrompts) ? data.customPrompts : [];
  for (const p of prompts as any[]) {
    if (Array.isArray(p?.requiredScopes) && p.requiredScopes.length > 0 && typeof p?.name === 'string') {
      requiredScopes.prompts[p.name] = p.requiredScopes as string[];
    }
  }
  const resources = Array.isArray(data?.customResources) ? data.customResources : [];
  for (const r of resources as any[]) {
    if (Array.isArray(r?.requiredScopes) && r.requiredScopes.length > 0 && typeof r?.uri === 'string') {
      requiredScopes.resources[r.uri] = r.requiredScopes as string[];
    }
  }
  const templates = Array.isArray(data?.customResourceTemplates) ? data.customResourceTemplates : [];
  for (const template of templates as any[]) {
    if (
      Array.isArray(template?.requiredScopes) &&
      template.requiredScopes.length > 0 &&
      typeof template?.uriTemplate === 'string'
    ) {
      requiredScopes.resources[template.uriTemplate] = template.requiredScopes as string[];
    }
  }

  return {
    enabled: !!auth?.enabled,
    schemes: Array.from(schemes),
    methods,
    claims,
    jwt,
    ...(jwtRt.mode !== 'legacyAesCtr' ? { oauth } : {}),
    ...(Object.keys(discovery).length ? { discovery } : {}),
    ...(Object.keys(requiredScopes.tools).length ||
    Object.keys(requiredScopes.prompts).length ||
    Object.keys(requiredScopes.resources).length
      ? { requiredScopes }
      : {}),
    ...(Array.isArray(data?.defaultReadScopes) && data.defaultReadScopes.length > 0
      ? { defaultReadScopes: [...data.defaultReadScopes] }
      : {}),
    headers: { authorization: 'Authorization: Bearer <token>' },
    httpHeadersResource: 'use://http-headers',
  };
}
