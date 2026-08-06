import { createMcpServer } from './create-mcp-server.js';
import { startDualEraStdioServer } from './v2/stdio.js';

/**
 * Start STDIO server (dual-era).
 *
 * The connection's protocol era is decided from its opening message and pinned for the process
 * lifetime — see `v2/stdio.ts` for the routing rules. Modern (2026-07-28) clients are served by
 * the v2 package; legacy clients keep the unchanged v1 `Server` built here.
 *
 * The legacy MCP `Server` is built lazily, NOT at module load time: `createMcpServer` reads
 * `global.__MCP_PROJECT_DATA__` to decide conditional capabilities (`prompts`, `completions`,
 * `tasks` — standard §8.2 / §8.7). `initMcpServer` only populates that global just before calling
 * this function, so an import-time construction would see empty project data and silently drop the
 * prompts capability (and its handlers) on stdio.
 */
export async function startStdioServer(): Promise<void> {
  await startDualEraStdioServer(
    () => createMcpServer('stdio') as unknown as { connect: (t: unknown) => Promise<void> },
  );
}
