import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isolatedWorker } from './helpers/isolated-worker.mjs';
import { spawnServer } from './helpers/spawn-server.mjs';

const marker = 'SECRET_HEADER_MARKER_7f4c9a31';
const requirement = {
  name: 'x-project-secret',
  description: 'Synthetic private header',
  isOptional: true,
  isSecret: true,
};
const ordinaryRequirement = {
  name: 'x-project-visible',
  description: 'Synthetic ordinary header',
  isOptional: true,
};
const worker = await isolatedWorker('http', {}, { EXPECTED_SECRET_HEADER: marker });
const tester = spawnServer({
  port: 39860,
  label: 'secret-boundary',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: true, useAuth: false },
  },
});

try {
  await tester.waitReady();
  const serverName = 'secret-boundary-target';
  const connect = await fetch(`${tester.url}/agent-tester/api/mcp/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: serverName, url: `${worker.url}/mcp`, transport: 'http' }),
  });
  assert.equal(connect.status, 200);
  assert.equal((await connect.json()).success, true);

  const update = await fetch(`${tester.url}/agent-tester/api/mcp/headers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serverName,
      headers: { 'x-project-secret': marker, 'x-project-visible': 'visible' },
      headerRequirements: [ordinaryRequirement, requirement],
    }),
  });
  const updateText = await update.text();
  assert.equal(update.status, 200);
  assert.doesNotMatch(updateText, new RegExp(marker));
  assert.match(updateText, /"x-project-secret":"\*\*\*"/);

  const serversText = await (await fetch(`${tester.url}/agent-tester/api/mcp/servers`)).text();
  assert.doesNotMatch(serversText, new RegExp(marker));
  assert.match(serversText, /"x-project-visible":"visible"/);

  const toolCall = await fetch(`${tester.url}/agent-tester/api/mcp/call-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverName, toolName: 'header_probe', parameters: {} }),
  });
  const toolCallText = await toolCall.text();
  assert.equal(toolCall.status, 200);
  assert.match(toolCallText, /exactSecretReceived\\?":true/);
  assert.match(toolCallText, /ordinaryReceived\\?":true/);
  assert.doesNotMatch(toolCallText, new RegExp(marker));

  for (const [headers, expected] of [
    [{ 'x-project-secret': marker }, { secret: true, ordinary: false }],
    [{ 'x-project-visible': 'visible' }, { secret: false, ordinary: true }],
  ]) {
    const singleUpdate = await fetch(`${tester.url}/agent-tester/api/mcp/headers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName, headers, headerRequirements: [ordinaryRequirement, requirement] }),
    });
    assert.equal(singleUpdate.status, 200);
    const singleCall = await fetch(`${tester.url}/agent-tester/api/mcp/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName, toolName: 'header_probe', parameters: {} }),
    });
    const singleText = await singleCall.text();
    assert.match(singleText, new RegExp(`exactSecretReceived\\\\?":${expected.secret}`));
    assert.match(singleText, new RegExp(`ordinaryReceived\\\\?":${expected.ordinary}`));
  }

  const badConnect = await fetch(`${tester.url}/agent-tester/api/mcp/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'invalid-secret-target',
      url: 'http://127.0.0.1:1/mcp',
      transport: 'http',
      headers: { 'x-project-secret': marker },
      headerRequirements: [requirement],
    }),
  });
  assert.doesNotMatch(await badConnect.text(), new RegExp(marker));

  const browserScript = await readFile('src/core/web/static/agent-tester/script.js', 'utf8');
  const saveMethod = browserScript.match(
    /  saveHeaderValuesToStorage\(\) \{([\s\S]*?)\n  \}\n\n  loadHeaderValuesFromStorage\(\)/,
  );
  assert.ok(saveMethod, 'saveHeaderValuesToStorage method must be present');
  let storageSnapshot = '';
  const localStorage = { setItem: (_key, value) => (storageSnapshot = value) };
  const saveHeaderValuesToStorage = new Function('localStorage', saveMethod[1]);
  saveHeaderValuesToStorage.call(
    {
      usedHeaders: [requirement],
      getHeadersFromForm: () => ({ 'x-project-secret': marker, 'x-project-visible': 'visible' }),
      getHeaderStorageKey: () => 'test-header-values',
    },
    localStorage,
  );
  assert.doesNotMatch(storageSnapshot, new RegExp(marker));
  assert.match(storageSnapshot, /x-project-visible/);

  const diagnostics = `${tester.getStdout()}\n${tester.getStderr()}\n${worker.output()}`;
  assert.doesNotMatch(diagnostics, new RegExp(marker));
  console.log('Secret marker absent from API responses and process diagnostics.');
} finally {
  tester.kill();
  await worker.close();
}
