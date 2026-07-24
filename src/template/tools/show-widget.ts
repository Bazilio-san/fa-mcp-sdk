import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  asTextContent,
  hostSupportsMcpApps,
  IResourceData,
  IToolHandlerParams,
  MCP_APPS_RESOURCE_MIME_TYPE,
  TToolHandlerResponse,
} from '../../core/index.js';

import { ITemplateTool } from './tool.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/** Address of the widget resource this tool references (MCP Apps referenced-widget pattern). */
const WIDGET_URI = 'ui://example/demo-widget.html';

/**
 * `show_widget` — demonstrates the MCP Apps **referenced-widget** flow end-to-end. Call it when the
 * user asks to see a widget: with the host's "Apps" mode on it returns an interactive UI widget; with
 * it off it returns a short hint to enable Apps mode, which the model must relay verbatim (see the
 * `show_widget` tool prompt). Takes no input.
 *
 * Two MCP Apps delivery patterns exist; this tool shows the referenced one, `example_tool` shows the
 * embedded one:
 *
 * - **Referenced (this tool).** The definition DECLARES the widget's address in `_meta.ui.resourceUri`.
 *   The host fetches that static `ui://` shell once via `resources/read`, renders it, then hands this
 *   call's `structuredContent` to the widget through `ui/notifications/tool-result`. The shell carries
 *   no per-call data, so the same HTML serves every invocation and the host can review/cache it and its
 *   `_meta.ui` metadata up front.
 * - **Embedded (`example_tool`).** The tool builds the full HTML per call and returns it inline in the
 *   result `content[]`. Simpler and fully dynamic, but nothing about the widget is known before the call.
 */
const definition: Tool = {
  name: 'show_widget',
  title: 'Show demo widget',
  description: `Show a demonstration UI widget.

Call this whenever the user asks to show or demonstrate a widget e.g.:
- "show widget"
- "widget demo"
- "show the demo UI"

When the host supports MCP Apps (Agent Tester with the "Apps" toggle on) it renders an interactive widget;
otherwise it returns a short instruction to enable Apps mode, which you MUST relay to the user verbatim.`,
  inputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  // Referenced-widget link: the host reads `ui://example/demo-widget.html` (registered below) instead
  // of expecting the HTML inline in the result. This declaration is also what lets the Agent Tester's
  // Inspector tab flag the tool with a "UI" badge and a "Launch widget" button before any call.
  _meta: { ui: { resourceUri: WIDGET_URI } },
};

function handler(params: IToolHandlerParams): TToolHandlerResponse {
  if (!hostSupportsMcpApps(params.clientCapabilities)) {
    return asTextContent('To demonstrate the widget, enable Apps mode');
  }
  // No HTML is built here — the widget shell is the static `ui://` resource below. The per-call data
  // travels in `structuredContent`; the host forwards it to the shell via `ui/notifications/tool-result`.
  // The text block keeps the model (and any non-UI client) informed.
  const data = {
    status: 'MCP App is working',
    theme: 'adapts to the host (light/dark)',
    size: 'fits the content',
    time: new Date().toLocaleString(),
  };
  return {
    content: [{ type: 'text', text: 'Widget shown (MCP Apps demo, referenced ui:// resource).' }],
    structuredContent: data,
  } as unknown as TToolHandlerResponse;
}

/**
 * Static HTML shell for the referenced widget. The host fetches it once via `resources/read` and
 * renders it in a sandboxed iframe. Unlike the embedded widgets it bakes in NO per-call values: a tiny
 * inline script speaks the minimal MCP Apps view protocol — it announces itself with `ui/initialize`,
 * adopts the host theme (light/dark), then renders whatever data arrives in `ui/notifications/tool-result`
 * and reports its height via `ui/notifications/size-changed` so the frame fits the content. The host's
 * CSP allows inline `<script>`/`<style>` (`script-src 'self' 'unsafe-inline'`), so no external files are
 * needed.
 */
function renderDemoWidgetShell(): string {
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
  .hint { margin-top: 12px; font-size: 11px; color: #94a3b8; font-style: italic; }
</style>
</head>
<body>
  <div class="card">
    <h1 class="title"><span class="dot"></span> Demo widget</h1>
    <div id="rows"></div>
    <div class="hint" id="hint">Waiting for the tool result…</div>
  </div>
  <script>
    (function () {
      var INIT_ID = 1;
      var LABELS = { status: 'Status', theme: 'Theme', size: 'Size', time: 'Time' };
      function send(method, params, id) {
        parent.postMessage({ jsonrpc: '2.0', method: method, params: params, id: id }, '*');
      }
      function reportSize() {
        send('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
      }
      function applyTheme(theme) {
        if (theme && theme.name === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); }
        else { document.documentElement.removeAttribute('data-theme'); }
      }
      function render(result) {
        var data = (result && result.structuredContent) || {};
        var rows = document.getElementById('rows');
        rows.textContent = '';
        Object.keys(data).forEach(function (key) {
          var row = document.createElement('div'); row.className = 'row';
          var k = document.createElement('span'); k.className = 'k'; k.textContent = LABELS[key] || key;
          var v = document.createElement('span'); v.className = 'v'; v.textContent = String(data[key]);
          row.appendChild(k); row.appendChild(v); rows.appendChild(row);
        });
        document.getElementById('hint').textContent = 'MCP Apps demo (referenced ui:// resource): the static shell was fetched via resources/read; this data arrived through ui/notifications/tool-result.';
        reportSize();
      }
      window.addEventListener('message', function (e) {
        var msg = e && e.data;
        if (!msg || msg.jsonrpc !== '2.0') { return; }
        if (msg.id === INIT_ID && msg.result) {
          applyTheme(msg.result.hostContext && msg.result.hostContext.theme);
          send('ui/notifications/initialized', {});
          reportSize();
        } else if (msg.method === 'ui/notifications/host-context-changed') {
          applyTheme(msg.params && msg.params.theme);
        } else if (msg.method === 'ui/notifications/tool-result') {
          render(msg.params);
        }
      });
      // Announce the view; the host answers with theme, then pushes tool input/result notifications.
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

/**
 * The `ui://` resource backing `show_widget`. Registered with `start.ts` (via `templateUiResources`)
 * so the host can `resources/read` it. `_meta.ui` carries static, reviewable defaults — here a hint to
 * draw a border around the frame.
 */
const widgetResource: IResourceData = {
  uri: WIDGET_URI,
  name: 'demo-widget',
  title: 'Demo widget (MCP App)',
  description: 'Static shell for the show_widget MCP App. Renders data delivered via ui/notifications/tool-result.',
  mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
  content: renderDemoWidgetShell(),
  requireAuth: false,
  _meta: { ui: { prefersBorder: true } },
};

export const showWidget: ITemplateTool = { definition, handler, uiResources: [widgetResource] };
