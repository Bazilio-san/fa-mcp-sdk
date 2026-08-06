#!/usr/bin/env node

/**
 * Streamable HTTP transport check for the MODERN protocol revision (MCP 2026-07-28), run against a
 * server that is already up (`npm run build && npm start`).
 *
 * Uses `McpModernHttpClient`, which is built on the official `@modelcontextprotocol/client` v2
 * package: no `initialize` handshake, a per-request `_meta` envelope, and the required
 * `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers on every POST. The sibling scripts
 * (`test-http.js`, `test-sse.js`, `test-stdio.js`) exercise the LEGACY era of the same server.
 */

import { appConfig, McpModernHttpClient, getAuthHeadersForTests } from '../../../dist/core/index.js';

import TEMPLATE_TESTS from './test-cases.js';

const baseURL = (process.env.TEST_MCP_SERVER_URL || `http://localhost:${appConfig.webServer.port}`).replace(/\/+$/, '');

async function runTestGroup(title, tests, client) {
  console.log(`\n${title}:`);
  let passed = 0;
  for (const test of tests) {
    try {
      const res = await test(client);
      if (res.passed) {
        console.log(`  ✅  ${res.name}`);
        passed++;
      } else {
        console.log(`  ❌  ${res.name}`);
        if (res.details) {
          console.log('     ', res.details);
        }
      }
    } catch (e) {
      console.log(`  ❌  ${test.name || 'test'}:`, e.message);
    }
  }
  return passed;
}

async function main() {
  console.log(`MCP 2026-07-28 (modern) HTTP transport — ${baseURL}/mcp`);
  const client = new McpModernHttpClient(baseURL, {
    headers: await getAuthHeadersForTests(),
    clientInfo: { name: 'http-modern-test', version: '1.0.0' },
  });

  try {
    const discovered = await client.discover();
    console.log(`\nserver/discover:`);
    console.log(`  supportedVersions: ${discovered.supportedVersions.join(', ')}`);
    console.log(`  capabilities:      ${Object.keys(discovered.capabilities).join(', ')}`);
    const serverInfo = discovered._meta?.['io.modelcontextprotocol/serverInfo'];
    console.log(`  serverInfo:        ${serverInfo ? `${serverInfo.name} ${serverInfo.version}` : '(absent)'}`);
    console.log(`  cache hints:       ttlMs=${discovered.ttlMs} cacheScope=${discovered.cacheScope}`);
    console.log(`  negotiated era:    ${client.protocolEra}`);

    const p1 = await runTestGroup('Prompts', TEMPLATE_TESTS.prompts, client);
    const p2 = await runTestGroup('Resources', TEMPLATE_TESTS.resources, client);
    const p3 = await runTestGroup('Tools', TEMPLATE_TESTS.tools, client);

    const total = TEMPLATE_TESTS.prompts.length + TEMPLATE_TESTS.resources.length + TEMPLATE_TESTS.tools.length;
    const sum = p1 + p2 + p3;
    console.log(`\nSummary: ${sum}/${total} tests passed`);
    if (sum < total) {
      process.exitCode = 1;
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((e) => {
    console.error('Test failed:', e?.message || e);
    process.exit(1);
  });
