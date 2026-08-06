import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { createV2ServerFactory } from './factory.js';
import { handleModernTaskMethod } from './tasks-methods.js';

/**
 * Dual-era stdio serving (2026-07-28 §"stdio: Backward Compatibility").
 *
 * The era is a property of the connection, decided from its opening message and pinned for the
 * process lifetime:
 *   - modern — the message carries the per-request `_meta` envelope, or is the `server/discover`
 *     probe a dual-era client sends first. Served by the v2 package's `serveStdio`.
 *   - legacy — anything else (`initialize` and the 2025-era flow). Served by the v1 `Server` from
 *     `createMcpServer('stdio')`, unchanged: it keeps the surface the v2 factory does not
 *     register (the `logging` capability, `resources/subscribe`, the legacy `tasks/*` methods),
 *     which desktop clients rely on.
 *
 * Both branches receive the same stdin lines through {@link LineTransport}: this module owns the
 * NDJSON framing, buffers messages that arrive before the era is decided, and replays them into
 * the branch that wins.
 */

type TJsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { _meta?: Record<string, unknown> };
};

/** A message opens a modern connection when it declares the protocol version or probes discovery. */
const isModernOpening = (message: TJsonRpcMessage): boolean =>
  Boolean(message?.params?._meta?.['io.modelcontextprotocol/protocolVersion']) || message?.method === 'server/discover';

/**
 * A `Transport` over pre-parsed NDJSON messages: the router pushes inbound messages in with
 * {@link deliver}, outbound messages are written to `stdout` as single newline-terminated lines.
 * Structurally compatible with both SDK generations' `Transport` interface.
 */
class LineTransport {
  private handler: ((message: unknown) => void) | undefined = undefined;

  private queued: unknown[] = [];

  onerror?: (error: Error) => void;

  onclose?: () => void;

  constructor(private readonly out: NodeJS.WritableStream) {}

  /** Messages delivered before the server attached its handler are replayed on assignment. */
  set onmessage(handler: ((message: unknown) => void) | undefined) {
    this.handler = handler;
    if (handler && this.queued.length > 0) {
      const pending = this.queued;
      this.queued = [];
      queueMicrotask(() => pending.forEach((message) => handler(message)));
    }
  }

  get onmessage(): ((message: unknown) => void) | undefined {
    return this.handler;
  }

  deliver(message: unknown): void {
    if (this.handler) {
      this.handler(message);
    } else {
      this.queued.push(message);
    }
  }

  async start(): Promise<void> {
    // stdin is read by the router, not by the transport.
  }

  async send(message: unknown): Promise<void> {
    // One atomic write per message: interleaving with another writer stays line-safe.
    this.out.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

let stdioHandle: StdioServerHandle | undefined;

/**
 * Start the dual-era stdio server. Returns once the reader is attached; the process then serves
 * whichever era its client opens with.
 */
export async function startDualEraStdioServer(
  createLegacyServer: () => { connect: (t: unknown) => Promise<void> },
): Promise<void> {
  const transport = new LineTransport(process.stdout);
  let era: 'legacy' | 'modern' | undefined;

  const decideEra = async (message: TJsonRpcMessage): Promise<void> => {
    if (isModernOpening(message)) {
      era = 'modern';
      // `legacy: 'reject'` — the era is already decided here; the v2 entry must not re-negotiate.
      stdioHandle = serveStdio(createV2ServerFactory('stdio'), {
        transport: transport as never,
        legacy: 'reject',
        onerror: (error: Error) => console.error(`MCP stdio (modern) error: ${error.message}`),
      });
      console.error('MCP Server running on stdio (protocol revision 2026-07-28)');
      return;
    }
    era = 'legacy';
    const server = createLegacyServer();
    await server.connect(transport);
    console.error('MCP Server running on stdio (legacy protocol revision)');
  };

  let buffer = '';
  let deciding: Promise<void> | undefined;

  const handleLine = async (line: string): Promise<void> => {
    const text = line.trim();
    if (!text) {
      return;
    }
    let message: TJsonRpcMessage;
    try {
      message = JSON.parse(text) as TJsonRpcMessage;
    } catch (error) {
      // Before the era is known there is no transport to report through — stderr is the only
      // channel the stdio binding allows for diagnostics.
      const report = error instanceof Error ? error : new Error(String(error));
      if (era) {
        transport.onerror?.(report);
      } else {
        console.error(`MCP stdio: malformed JSON-RPC line ignored: ${report.message}`);
      }
      return;
    }
    if (!era) {
      deciding ??= decideEra(message);
      await deciding;
    }
    // Tasks extension (2026-07-28): the v2 method registry rejects the `tasks/*` spec names before
    // registered handlers run, so the extension is served in front of it — same as on HTTP.
    if (era === 'modern') {
      const answer = handleModernTaskMethod(message, undefined);
      if (answer) {
        await transport.send(answer.json);
        return;
      }
    }
    transport.deliver(message);
  };

  // Serialize line handling: era decision is async, and messages must keep their arrival order.
  let chain: Promise<void> = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      chain = chain
        .then(() => handleLine(line))
        .catch((error: unknown) => {
          console.error(
            `MCP stdio: failed to handle message: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
  });
  process.stdin.on('end', () => {
    void chain.then(async () => {
      await stdioHandle?.close();
      await transport.close();
    });
  });
}
