import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { InputRequests, InputResponses, McpSubscription, SubscriptionFilter } from '@modelcontextprotocol/client';

import { BaseMcpClient } from './BaseMcpClient.js';

/**
 * MCP client for protocol revision 2026-07-28 (Streamable HTTP), built on the official
 * `@modelcontextprotocol/client` v2 package — so a test exercising it also exercises the reference
 * client implementation against our server.
 *
 * There is no `initialize` handshake: the transport puts the required per-request `_meta` envelope
 * and the `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers on every POST, and nothing is
 * shared between requests. `connect()` here only wires the transport up.
 *
 * Beyond {@link BaseMcpClient}'s common surface this exposes the revision's own operations:
 * {@link discover}, {@link listen} (the `subscriptions/listen` stream) and
 * {@link callToolWithInput} (the multi round-trip retry loop).
 */
export class McpModernHttpClient extends BaseMcpClient {
  private readonly url: URL;
  private readonly requestTimeoutMs: number;
  private readonly client: Client;
  private transport: StreamableHTTPClientTransport | undefined;
  private connected = false;

  constructor(
    baseURL: string,
    options?: {
      endpointPath?: string;
      headers?: Record<string, string>;
      requestTimeoutMs?: number;
      clientInfo?: { name: string; version: string };
      /** Advertised per request, e.g. `{ elicitation: { form: {} } }` or the tasks extension. */
      clientCapabilities?: Record<string, unknown>;
    },
  ) {
    super(options?.headers ?? {}, {
      modern: true,
      ...(options?.clientCapabilities ? { clientCapabilities: options.clientCapabilities } : {}),
      ...(options?.clientInfo ? { clientInfo: options.clientInfo } : {}),
    });
    this.url = new URL(options?.endpointPath ?? '/mcp', `${baseURL.replace(/\/$/, '')}/`);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 120_000;
    this.client = new Client(this.clientInfo, {
      capabilities: this.clientCapabilities as never,
      // The reference client negotiates the LEGACY era by default (`mode: 'legacy'`); pinning the
      // revision is what makes it speak 2026-07-28 — no handshake, per-request `_meta`.
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    } as never);
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.transport = new StreamableHTTPClientTransport(this.url, {
      requestInit: { headers: this.customHeaders },
    });
    await this.client.connect(this.transport as never);
    this.connected = true;
  }

  /** The protocol era the client settled on (`modern` for 2026-07-28), once a request has run. */
  get protocolEra(): string | undefined {
    return this.client.getProtocolEra();
  }

  override async close(): Promise<void> {
    await this.transport?.close();
    this.transport = undefined;
    this.connected = false;
  }

  /** `server/discover` — supported versions, capabilities and identity in one call. */
  override async discover() {
    await this.ensureConnected();
    return this.client.discover({ timeout: this.requestTimeoutMs });
  }

  /**
   * Open a `subscriptions/listen` stream. The returned subscription carries the acknowledged
   * filter and the notification stream; close it to unsubscribe.
   */
  async listen(filter: SubscriptionFilter): Promise<McpSubscription> {
    await this.ensureConnected();
    return this.client.listen(filter, { timeout: this.requestTimeoutMs });
  }

  /**
   * Call a tool, driving the multi round-trip (MRTR) loop: when the server answers
   * `resultType: "input_required"`, `provideInput` is asked for the answers and the original call
   * is retried with them plus the echoed `requestState`, until the server returns a final result.
   *
   * @param provideInput — resolves the server's `inputRequests` (keys are server-assigned ids).
   * @param maxRounds — safety bound on the retry loop.
   */
  async callToolWithInput(
    toolName: string,
    args: Record<string, unknown>,
    provideInput: (requests: InputRequests) => Promise<InputResponses> | InputResponses,
    maxRounds = 5,
  ): Promise<any> {
    let inputResponses: InputResponses | undefined;
    let requestState: string | undefined;
    for (let round = 0; round < maxRounds; round++) {
      const result: any = await this.callTool(toolName, {
        ...args,
        ...(inputResponses ? { inputResponses } : {}),
        ...(requestState ? { requestState } : {}),
      } as Record<string, unknown>);
      if (result?.resultType !== 'input_required') {
        return result;
      }
      inputResponses = await provideInput(result.inputRequests ?? {});
      ({ requestState } = result);
    }
    throw new Error(`callToolWithInput: the server kept requesting input for ${maxRounds} rounds`);
  }

  protected override async sendRequest(method: string, params: any): Promise<any> {
    await this.ensureConnected();
    // MRTR retry fields ride at the top level of `params`, not inside `arguments`.
    const { inputResponses, requestState, ...rest } = (params ?? {}) as Record<string, any>;
    const args = (rest.arguments ?? {}) as Record<string, unknown>;
    const { inputResponses: argInputResponses, requestState: argRequestState, ...toolArgs } = args;
    const finalParams = {
      ...rest,
      ...(rest.arguments ? { arguments: toolArgs } : {}),
      ...((inputResponses ?? argInputResponses) ? { inputResponses: inputResponses ?? argInputResponses } : {}),
      ...((requestState ?? argRequestState) ? { requestState: requestState ?? argRequestState } : {}),
    };
    return this.client.request(
      { method, params: finalParams } as never,
      undefined as never,
      {
        timeout: this.requestTimeoutMs,
        allowInputRequired: true,
      } as never,
    );
  }
}
