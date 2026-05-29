/**
 * Phase 7 / WI-3 — InMemoryEventStore for SSE resumability (standard §6).
 *
 * Exercises the store's contract directly (the same EventStore the Streamable HTTP transport calls
 * when a client reconnects with Last-Event-ID):
 *  - replayEventsAfter re-sends only the events that follow the given id, in order, same stream;
 *  - events from other streams are not replayed;
 *  - an unknown / evicted Last-Event-ID yields no replay and no error;
 *  - the ring buffer evicts the oldest events past maxStoredEvents.
 *
 * Run after build: node tests/sse-resumability.test.mjs
 */
import assert from 'node:assert/strict';

import { InMemoryEventStore } from '../dist/core/web/event-store.js';

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌  ${name}\n      ${err.message}`);
  }
};

const msg = (n) => ({ jsonrpc: '2.0', method: 'notifications/message', params: { n } });

const replay = async (store, lastId) => {
  const sent = [];
  const streamId = await store.replayEventsAfter(lastId, {
    send: async (eventId, message) => {
      sent.push({ eventId, message });
    },
  });
  return { sent, streamId };
};

await test('replays only events after the given id, in order', async () => {
  const store = new InMemoryEventStore();
  const id1 = await store.storeEvent('s1', msg(1));
  const id2 = await store.storeEvent('s1', msg(2));
  const id3 = await store.storeEvent('s1', msg(3));
  const { sent, streamId } = await replay(store, id1);
  assert.equal(streamId, 's1');
  assert.deepEqual(
    sent.map((e) => e.eventId),
    [id2, id3],
  );
  assert.deepEqual(
    sent.map((e) => e.message.params.n),
    [2, 3],
  );
});

await test('does not replay events from a different stream', async () => {
  const store = new InMemoryEventStore();
  const a1 = await store.storeEvent('s1', msg(1));
  await store.storeEvent('s2', msg(99)); // other stream, interleaved
  const a2 = await store.storeEvent('s1', msg(2));
  const { sent } = await replay(store, a1);
  assert.deepEqual(
    sent.map((e) => e.eventId),
    [a2],
  );
});

await test('unknown / evicted Last-Event-ID → no replay, no error', async () => {
  const store = new InMemoryEventStore();
  await store.storeEvent('s1', msg(1));
  const { sent, streamId } = await replay(store, 's1_0000000000009999');
  assert.equal(streamId, '');
  assert.equal(sent.length, 0);
});

await test('empty Last-Event-ID → no replay', async () => {
  const store = new InMemoryEventStore();
  await store.storeEvent('s1', msg(1));
  const { sent, streamId } = await replay(store, '');
  assert.equal(streamId, '');
  assert.equal(sent.length, 0);
});

await test('ring buffer evicts oldest beyond maxStoredEvents', async () => {
  const store = new InMemoryEventStore(3);
  const id1 = await store.storeEvent('s1', msg(1)); // will be evicted
  await store.storeEvent('s1', msg(2));
  await store.storeEvent('s1', msg(3));
  await store.storeEvent('s1', msg(4)); // pushes out id1
  // id1 is gone → treated as unknown id, no replay.
  const { sent, streamId } = await replay(store, id1);
  assert.equal(streamId, '');
  assert.equal(sent.length, 0);
});

await test('getStreamIdForEventId returns the owning stream', async () => {
  const store = new InMemoryEventStore();
  const id = await store.storeEvent('streamX', msg(1));
  assert.equal(await store.getStreamIdForEventId(id), 'streamX');
  assert.equal(await store.getStreamIdForEventId('nope_0'), undefined);
});

console.log(failed === 0 ? '\nAll SSE resumability tests passed.' : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
