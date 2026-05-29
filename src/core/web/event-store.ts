/**
 * Standard §6 (MAY) — in-memory EventStore for Streamable HTTP SSE resumability.
 *
 * When a client reconnects to `GET /mcp` carrying a `Last-Event-ID` header, the SDK transport
 * calls {@link InMemoryEventStore.replayEventsAfter} to re-send the messages the client missed.
 * This implementation keeps a bounded ring buffer of the most recent events in process memory:
 * it survives only within a single running server instance and is lost on restart. For
 * multi-instance deployments a shared/persistent store (Redis etc.) would be required — that
 * is intentionally out of scope here.
 */
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { EventStore, EventId, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

interface IStoredEvent {
  streamId: StreamId;
  message: JSONRPCMessage;
}

const DEFAULT_MAX_EVENTS = 1000;

/**
 * Ring-buffer EventStore. Event ids are `<streamId>_<paddedSeq>` where `seq` is a process-global
 * monotonic counter, zero-padded so lexicographic ordering matches insertion order (the SDK
 * compares ids as strings during replay). Once the buffer exceeds `maxStoredEvents`, the oldest
 * event is evicted; a `Last-Event-ID` pointing past the retained window yields no replay (the
 * client simply resumes from the current moment, without error).
 */
export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<EventId, IStoredEvent>();

  private readonly maxStoredEvents: number;

  private seq = 0;

  constructor(maxStoredEvents: number = DEFAULT_MAX_EVENTS) {
    this.maxStoredEvents = maxStoredEvents > 0 ? maxStoredEvents : DEFAULT_MAX_EVENTS;
  }

  private nextEventId(streamId: StreamId): EventId {
    // 16-digit zero-padded counter keeps ids lexicographically ordered for the lifetime of the process.
    const padded = String(this.seq++).padStart(16, '0');
    return `${streamId}_${padded}`;
  }

  private static streamIdFromEventId(eventId: EventId): StreamId {
    const idx = eventId.lastIndexOf('_');
    return idx === -1 ? '' : eventId.slice(0, idx);
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = this.nextEventId(streamId);
    this.events.set(eventId, { streamId, message });
    // FIFO eviction via Map insertion order keeps the buffer bounded.
    while (this.events.size > this.maxStoredEvents) {
      const oldest = this.events.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.events.delete(oldest);
    }
    return eventId;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    const stored = this.events.get(eventId);
    return stored?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    // Unknown id (never stored or already evicted) → no replay; the transport starts a fresh stream.
    if (!lastEventId || !this.events.has(lastEventId)) {
      return '';
    }
    const streamId = InMemoryEventStore.streamIdFromEventId(lastEventId);
    if (!streamId) {
      return '';
    }
    let afterLast = false;
    // Map iteration follows insertion order, which equals seq order — no sort needed.
    for (const [eventId, stored] of this.events) {
      if (eventId === lastEventId) {
        afterLast = true;
        continue;
      }
      if (afterLast && stored.streamId === streamId) {
        await send(eventId, stored.message);
      }
    }
    return streamId;
  }
}
