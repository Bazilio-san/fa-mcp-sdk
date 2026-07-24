/**
 * Shared widget markup for the template's MCP Apps demos. This is NOT a tool (its filename is not any
 * tool's `name`) — it is a helper used by more than one tool (`example_tool`, `show_widget`), so per
 * the "one tool = one file" convention it lives in `tools/` under a descriptive, non-tool name.
 */

/** Escape a value for safe interpolation into the widget HTML. */
export function escapeHtml(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build the self-contained HTML document for an MCP App View — a titled card with `key: value` rows
 * and a footer hint. Shared by every template widget so the look and the view-protocol plumbing live
 * in one place.
 *
 * The document is rendered inside a sandboxed iframe by the host. It is fully static apart from a
 * tiny inline script that speaks the minimal MCP Apps view protocol: it announces itself with
 * `ui/initialize`, adopts the host theme (light/dark) from the reply, and reports its content height
 * via `ui/notifications/size-changed` so the frame sizes to fit. The host's CSP allows inline
 * `<script>`/`<style>` (`script-src 'self' 'unsafe-inline'`), so no external files are needed.
 */
export function renderWidgetDocument(
  title: string,
  rows: Array<{ k: string; v: string; mono?: boolean }>,
  hint: string,
): string {
  const rowsHtml = rows
    .map(
      (r) =>
        `    <div class="row"><span class="k">${escapeHtml(r.k)}</span>` +
        `<span class="v${r.mono ? ' q' : ''}">${escapeHtml(r.v)}</span></div>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #f8fafc; color: #0f172a; padding: 16px;
  }
  html[data-theme="dark"] body { background: #0b0b0e; color: #fafafa; }
  .card {
    background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 16px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  html[data-theme="dark"] .card { background: #18181b; border-color: #27272a; }
  .title { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 15px; font-weight: 700; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; }
  .row { display: flex; gap: 10px; padding: 7px 0; font-size: 13px; border-top: 1px solid #eef2f7; }
  html[data-theme="dark"] .row { border-top-color: #27272a; }
  .row:first-of-type { border-top: none; }
  .k { min-width: 92px; color: #64748b; }
  html[data-theme="dark"] .k { color: #a1a1aa; }
  .v { font-weight: 500; word-break: break-word; }
  .q { font-family: 'Fira Code', ui-monospace, monospace; }
  .hint { margin-top: 12px; font-size: 11px; color: #94a3b8; font-style: italic; }
</style>
</head>
<body>
  <div class="card">
    <h1 class="title"><span class="dot"></span> ${escapeHtml(title)}</h1>
${rowsHtml}
    <div class="hint">${escapeHtml(hint)}</div>
  </div>
  <script>
    (function () {
      var INIT_ID = 1;
      function send(method, params, id) {
        parent.postMessage({ jsonrpc: '2.0', method: method, params: params, id: id }, '*');
      }
      function reportSize() {
        send('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
      }
      window.addEventListener('message', function (e) {
        var msg = e && e.data;
        if (!msg || msg.jsonrpc !== '2.0') return;
        if (msg.id === INIT_ID && msg.result) {
          var theme = msg.result.hostContext && msg.result.hostContext.theme;
          if (theme && theme.name === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
          send('ui/notifications/initialized', {});
          reportSize();
        }
      });
      // Announce the view; the host answers with theme, then we size the frame to our content.
      send('ui/initialize', {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'fa-mcp-sdk-template-widget', version: '1.0.0' },
        appCapabilities: {},
      }, INIT_ID);
      window.addEventListener('load', reportSize);
      window.addEventListener('resize', reportSize);
      setTimeout(reportSize, 400);
    })();
  </script>
</body>
</html>`;
}
