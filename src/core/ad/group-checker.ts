import { GroupChecker, IGroupCheckerConfig } from 'af-ad-ts';
import { appConfig } from '../bootstrap/init-config.js';
import { IDcConfig } from '../_types_/active-directory-config.js';
import { logger } from '../logger.js';

export interface IGroupCheckerInitResult {
  isUserInGroup: (userSam: string, groupSam: string) => Promise<boolean>;
  groupChecker: GroupChecker;
  domainName: string;
}

/**
 * Derives baseDn from LDAP controller URL.
 * Example: 'ldap://dc1.corp.company.com' -> 'DC=corp,DC=company,DC=com'
 */
function deriveBaseDnFromController (controllerUrl: string): string {
  const url = controllerUrl.replace(/^ldaps?:\/\//, '');
  const parts = url.split('.').reverse().slice(0, 3).reverse();
  return parts.map((v) => `DC=${v}`).join(',');
}

function getDefaultDomain (): { name: string; config: IDcConfig } | undefined {
  const domains = appConfig.ad?.domains;
  if (!domains) {return undefined;}

  for (const [name, config] of Object.entries(domains)) {
    if (config.default) {return { name, config };}
  }

  const names = Object.keys(domains);
  return names.length > 0 ? { name: names[0]!, config: domains[names[0]!]! } : undefined;
}

function validateConfig (config: IDcConfig, domain: string): string[] {
  const missing: string[] = [];
  if (!config.controllers?.length) {missing.push(`ad.domains.${domain}.controllers`);}
  if (!config.username) {missing.push(`ad.domains.${domain}.username`);}
  if (!config.password) {missing.push(`ad.domains.${domain}.password`);}
  return missing;
}

let cachedDefaultDomain: { name: string; config: IDcConfig } | undefined;

/**
 * Initializes AD Group Checker for checking user membership in AD groups.
 * @param domainName - Optional domain name. Uses default domain if not specified.
 * @throws Error if AD configuration is missing or incomplete
 */
export function initADGroupChecker (domainName?: string): IGroupCheckerInitResult {
  let domainConfig: IDcConfig | undefined;
  let resolvedDomainName: string;

  if (domainName) {
    domainConfig = appConfig.ad?.domains?.[domainName];
    resolvedDomainName = domainName;
    if (!domainConfig) {
      const available = Object.keys(appConfig.ad?.domains || {}).join(', ') || 'none';
      throw new Error(`AD domain "${domainName}" not found. Available: ${available}`);
    }
  } else {
    cachedDefaultDomain = cachedDefaultDomain || getDefaultDomain();
    if (!cachedDefaultDomain) {
      throw new Error('No AD domains configured in ad.domains');
    }
    domainConfig = cachedDefaultDomain.config;
    resolvedDomainName = cachedDefaultDomain.name;
  }

  const missing = validateConfig(domainConfig, resolvedDomainName);
  if (missing.length > 0) {
    throw new Error(`Incomplete AD config for "${resolvedDomainName}". Missing: ${missing.join(', ')}`);
  }

  const controllerUrl = domainConfig.controllers[0]!;
  const baseDn = domainConfig.baseDn || deriveBaseDnFromController(controllerUrl);

  const groupCheckerConfig: IGroupCheckerConfig = {
    url: controllerUrl,
    bindDN: domainConfig.username,
    bindPassword: domainConfig.password,
    baseDn,
    ...(appConfig.ad.groupCacheTtlMs !== undefined && { cacheTtlMs: appConfig.ad.groupCacheTtlMs }),
    ...(appConfig.ad.dnCacheTtlMs !== undefined && { dnCacheTtlMs: appConfig.ad.dnCacheTtlMs }),
  };

  const groupChecker = new GroupChecker(groupCheckerConfig);
  logger.info(`AD Group Checker initialized for "${resolvedDomainName}" (${controllerUrl}, baseDn: ${baseDn})`);

  return {
    isUserInGroup: (userSam, groupSam) => groupChecker.isUserInGroup(userSam, groupSam),
    groupChecker,
    domainName: resolvedDomainName,
  };
}
