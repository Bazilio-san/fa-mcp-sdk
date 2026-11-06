import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedWorker } from './helpers/isolated-worker.mjs';

for (const mode of ['http', 'stdio']) {
  await test(`legacy resource text serialization over ${mode}`, async (t) => {
    const worker = await isolatedWorker(mode);
    t.after(() => worker.close());
    const { McpHttpClient } = await import('../dist/core/utils/testing/McpHttpClient.js');
    const { McpStdioClient } = await import('../dist/core/utils/testing/McpStdioClient.js');
    const client = mode === 'http' ? new McpHttpClient(worker.url) : new McpStdioClient(worker.proc);
    t.after(() => client.close());
    await client.initialize();
    const headers = await client.readResource('use://http-headers');
    assert.deepEqual(JSON.parse(headers.contents[0].text), [
      { name: 'Authorization', description: 'Synthetic test header' },
      { name: 'x-project-secret', description: 'Synthetic private header', isOptional: true, isSecret: true },
    ]);
    if (mode === 'http') {
      assert.deepEqual(await (await fetch(`${worker.url}/used-http-headers`)).json(), [
        { name: 'Authorization', description: 'Synthetic test header' },
        { name: 'x-project-secret', description: 'Synthetic private header', isOptional: true, isSecret: true },
      ]);
    }
    for (const [uri, expected] of [
      ['test://object', { value: 1 }],
      ['test://array', [1, 2]],
    ]) {
      const result = await client.readResource(uri);
      assert.equal(typeof result.contents[0].text, 'string');
      assert.deepEqual(JSON.parse(result.contents[0].text), expected);
    }
    assert.equal((await client.readResource('test://string')).contents[0].text, 'hello');
    assert.equal(
      (await client.readResource('test://binary')).contents[0].blob,
      Buffer.from('hello').toString('base64'),
    );
    await assert.rejects(client.readResource('test://invalid'));
  });
}
