import { appConfig } from '../../../bootstrap/init-config.js';

const domains = appConfig.ad?.domains;

/** Lightweight AD presence check that does not initialize the NTLM package or its proxy-cache timer. */
export const isADEnabled: boolean = Boolean(
  domains && typeof domains === 'object' && !Array.isArray(domains) && Object.keys(domains).length > 0,
);
