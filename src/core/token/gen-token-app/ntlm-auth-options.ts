import { IAuthNtlmOptions, EAuthStrategy, IRsn } from 'ya-express-ntlm';
import { debugNtlmAuthFlow } from 'ya-express-ntlm';
import { red } from 'af-color';
import { tokenGenDomainConfig, getDomainConfig } from './ntlm-domain-config.js';
import { getNotAuthenticatedPageHTML, getNotAuthorizedPageHTML } from './ntlm-templates.js';
import {
  getTokenGenSessionData,
  setTokenGenSessionData
} from './ntlm-session-storage.js';

// Authorization logic - initially allow all authenticated users
export const authorize = (ntlm: any): boolean => {
  const { username, domain } = ntlm;
  // Simple authorization - can be extended with role checks
  if (username && domain) {
    console.log(`[TOKEN-GEN] User authorized: ${domain}\\${username}`);
    return true;
  }
  console.log(`[TOKEN-GEN] User authorization failed: ${domain}\\${username}`);
  return false;
};

export const tokenGenNtlmOptions: IAuthNtlmOptions = {
  getStrategy: () => tokenGenDomainConfig.strategy as EAuthStrategy,

  // Dynamic domain controllers based on the domain from NTLM message
  getDomainControllers: (rsn: IRsn) => {
    const domain = rsn?.req?.ntlm?.domain;
    const domainConfig = getDomainConfig(domain);
    console.log(`[TOKEN-GEN] Using domain controllers for domain "${domain || 'default'}": ${domainConfig.controllers.join(', ')}`);
    return domainConfig.controllers;
  },

  // Return default domain
  getDomain: () => tokenGenDomainConfig.defaultDomain,

  getTlsOptions: () => tokenGenDomainConfig.tlsOptions,
  getAuthDelay: () => 2000,

  // Generate proxy ID for caching
  getProxyId: (rsn: IRsn) => {
    const ip = rsn.req.ip || rsn.req.connection.remoteAddress || rsn.req.socket.remoteAddress || 'unknown';
    const userAgent = rsn.req.get('User-Agent') || 'unknown';
    return Buffer.from(`${ip}-${userAgent}`).toString('base64').substring(0, 16);
  },

  // Handle Type 2 message - set domain info
  onMessageType2: (rsn: IRsn, messageType2: any, _proxyCache: any, _proxyId: string) => {
    if (messageType2.domain) {
      rsn.req.ntlm = rsn.req.ntlm || {};
      rsn.req.ntlm.domain = messageType2.domain;
      console.log(`[TOKEN-GEN] Domain set from Type2 message: ${messageType2.domain}`);
    }
  },

  // Error handlers using HTML templates
  handleHttpError403: (rsn: IRsn) => {
    const { req: { protocol, hostname, ntlm: { username, domain } = {} }, res } = rsn;
    const msg = `HTTP 403: User ${username} did not pass authorization in the "${domain}" domain`;
    debugNtlmAuthFlow(red + msg);
    console.log(`[TOKEN-GEN] ${msg}`);
    const title = 'NOT AUTHENTICATED';
    res.status(403).send(getNotAuthenticatedPageHTML(title, protocol, hostname, username));
  },

  handleHttpError400: (res, message) => {
    console.log(`[TOKEN-GEN] HTTP 400: ${message}`);
    res.status(400).send(`400 Bad Request: ${message}`);
  },

  handleHttpError500: (res, message) => {
    console.log(`[TOKEN-GEN] HTTP 500: ${message}`);
    res.status(500).send(`500 Internal Server Error: ${message}`);
  },

  // Success authentication handler
  handleSuccessAuthentication: async (rsn: IRsn) => {
    const { req, res, next } = rsn;
    console.log(`[TOKEN-GEN] Authentication successful for: ${req.ntlm.domain}\\${req.ntlm.username}`);

    const isAuthorized = await authorize(req.ntlm);

    if (isAuthorized) {
      // Store authentication in session
      setTokenGenSessionData(req, req.ntlm as any);
      next();
      return;
    }

    // User authenticated but not authorized
    const { username } = req.ntlm || {};
    console.log(`[TOKEN-GEN] User not authorized: ${username}`);
    res.status(200).send(getNotAuthorizedPageHTML('NOT AUTHORIZED', username));
  },

  // Session management functions
  getCachedUserData: (rsn: IRsn) => {
    return getTokenGenSessionData(rsn.req) || {};
  },

  addCachedUserData: (rsn: IRsn, userData) => {
    setTokenGenSessionData(rsn.req, userData);
  },
};
