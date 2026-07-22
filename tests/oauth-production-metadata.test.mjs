/** Production OAuth metadata and challenges must not trust the request Host header. */
process.env.NODE_ENV = 'production';
process.env.NODE_CONFIG = JSON.stringify({
  webServer: {
    auth: {
      enabled: true,
      jwtToken: {
        mode: 'remoteJwks',
        algorithm: 'ES256',
        jwksUri: 'https://idp.example.test/.well-known/jwks.json',
        expectedIssuer: 'https://idp.example.test',
      },
      oauth: {
        resourceUrl: 'https://calendar.example.test/mcp',
        authorizationServers: ['https://idp.example.test'],
        resourceDocumentationUrl: '',
        advertisedScopes: ['calendar.read'],
      },
    },
  },
});

import assert from 'node:assert/strict';

const { buildProtectedResourceMetadata, buildWwwAuthenticateHeader } = await import('../dist/core/web/oauth-router.js');

const spoofedRequest = {
  protocol: 'http',
  get(name) {
    return String(name).toLowerCase() === 'host' ? 'attacker.invalid:9443' : undefined;
  },
};

const metadata = buildProtectedResourceMetadata(spoofedRequest);
assert.deepEqual(metadata, {
  resource: 'https://calendar.example.test/mcp',
  authorization_servers: ['https://idp.example.test'],
  bearer_methods_supported: ['header'],
  scopes_supported: ['calendar.read'],
  resource_documentation: 'https://calendar.example.test/docs',
});
assert.doesNotMatch(JSON.stringify(metadata), /attacker\.invalid/);

const challenge = buildWwwAuthenticateHeader(spoofedRequest);
assert.match(
  challenge,
  /resource_metadata="https:\/\/calendar\.example\.test\/\.well-known\/oauth-protected-resource"/,
);
assert.doesNotMatch(challenge, /attacker\.invalid/);

console.log('Production OAuth metadata ignores spoofed Host headers and uses explicit HTTPS configuration.');
