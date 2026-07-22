/**
 * Regression: an auth-disabled development profile may inherit incomplete JWT/OAuth placeholders.
 * They are inert and must not prevent the HTTP MCP server from starting.
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';

const server = spawnServer({
  port: 39_879,
  label: 'auth-disabled-preflight',
  configOverride: {
    webServer: {
      host: '127.0.0.1',
      originHosts: ['localhost'],
      auth: {
        enabled: false,
        jwtToken: {
          mode: 'remoteJwks',
          algorithm: 'invalid-while-disabled',
          jwksUri: '',
          expectedIssuer: '',
          userClaim: 'sub',
          clockSkew: 999,
          jwksCacheTtl: 0,
        },
        oauth: {
          resourceUrl: 'not-an-absolute-url',
          resourceDocumentationUrl: 'also-not-an-absolute-url',
          authorizationServers: ['not-an-absolute-url'],
          advertisedScopes: ['invalid scope'],
        },
      },
    },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
  },
});

try {
  await server.waitReady();
  const response = await fetch(`${server.url}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  const oauthMetadata = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
  assert.equal(oauthMetadata.status, 404, 'OAuth routes must stay unmounted while authentication is disabled');
  assert.doesNotMatch(server.getStderr(), /jwksUri is required|expectedIssuer is required|absolute HTTP\(S\) URL/);
  console.log('Auth-disabled development profile ignores inactive JWT/OAuth preflight fields.');
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 250));
}
