import { NTLMAuthError } from 'ya-express-ntlm';
import { isObject } from 'af-tools-ts';
import { appConfig } from '../../../bootstrap/init-config.js';
import { IDcConfig } from '../../../_types_/active-directory-config.js';

// Check if AD configuration is available
export const isNTLMEnabled: boolean = !!(appConfig.ad && isObject(appConfig.ad.domains) && Object.keys(appConfig.ad.domains).length);


// If AD config is null or undefined, NTLM authentication is disabled
if (!isNTLMEnabled) {
  console.log('[TOKEN-GEN] NTLM authentication is DISABLED - no AD configuration found');
} else {
  const { domains } = appConfig.ad;

  if (!isObject(domains) || !Object.keys(domains).length) {
    throw new NTLMAuthError('None of the Domain Controllers are specified');
  }
}

export const defaultTokenGenDomainConfig: IDcConfig = { controllers: [], username: '', password: '' };
export const tokenGenDomains: { [domainName: string]: IDcConfig } = {};

// Process and validate all domains (same logic as main NTLM example)
if (isNTLMEnabled) {
  const { domains } = appConfig.ad;

  Object.entries(domains).forEach(([domainName, item]) => {
    const { controllers } = item;
    if (!controllers?.length) {
      throw new NTLMAuthError(`No domain controller was specified for "${domainName}"`);
    }
    if (!Array.isArray(controllers)) {
      throw new NTLMAuthError(`Value of "${domainName}" must be an array`);
    }

    controllers.forEach((dc) => {
      if (!dc.startsWith('ldap')) {
        throw new NTLMAuthError(`Domain controller must be an AD and start with ldap:// | ldaps:// . Host: domain "${domainName}", DC: ${dc}`);
      }
    });

    // Enrich domain config with name
    item.name = domainName;
    tokenGenDomains[domainName] = item;

    // Set default domain configuration
    if (item.default && !defaultTokenGenDomainConfig.name) {
      Object.assign(defaultTokenGenDomainConfig, item);
      defaultTokenGenDomainConfig.name = domainName;
    }
  });

  if (!defaultTokenGenDomainConfig.name) {
    throw new NTLMAuthError('No default domain controller specified for token generation');
  }
}

// Export function to get domain config by name
export const getDomainConfig = (domainName?: string): IDcConfig => {
  if (!domainName) {
    return defaultTokenGenDomainConfig;
  }
  return tokenGenDomains[domainName] || defaultTokenGenDomainConfig;
};

export const tokenGenDomainConfig = {
  defaultDomain: isNTLMEnabled ? defaultTokenGenDomainConfig.name : undefined,
  domains: isNTLMEnabled ? tokenGenDomains : {},
  strategy: isNTLMEnabled ? (appConfig.ad.strategy || 'NTLM') : undefined, // from config or default NTLM
  tlsOptions: isNTLMEnabled ? appConfig.ad.tlsOptions : undefined, // from config if specified
};

// Debug info VVR
if (isNTLMEnabled) {
  console.log(`[TOKEN-GEN] Configured domains: ${Object.keys(tokenGenDomains).join(', ')}`);
  console.log(`[TOKEN-GEN] Default domain: ${tokenGenDomainConfig.defaultDomain}`);
  console.log(`[TOKEN-GEN] Strategy: ${tokenGenDomainConfig.strategy}`);
} else {
  console.log('[TOKEN-GEN] NTLM authentication disabled - no domain configuration available');
}
