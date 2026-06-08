const API_BASE = '/agent-tester';
const trim = (s) => String(s || '').trim();

const LLM_LS_KEY = 'mcpAgentLlmSettings';
const LLM_PRESET_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5-nano',
  'gpt-5-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
];
const LLM_DEFAULTS = {
  baseURL: '',
  apiKey: '',
  model: 'gpt-5.4-nano',
  temperature: 0.2,
  maxTokens: 2048,
  maxTurns: 10,
  toolResultLimitChars: 20000,
};

/**
 * Wrapper around fetch that always includes credentials (session cookie).
 */
function apiFetch(url, options = {}) {
  return fetch(url, { ...options, credentials: 'include' });
}

/**
 * Auth manager — handles login overlay when agentTester.useAuth is enabled.
 */
class AuthManager {
  static LS_KEY = 'agentTesterAuthCreds';

  constructor() {
    this._authenticated = false;
    this._authRequired = false;
  }

  /** Check auth status and show login if needed. Returns true if app can proceed. */
  async init() {
    try {
      const resp = await apiFetch(`${API_BASE}/api/auth/status`);
      const status = await resp.json();

      if (!status.authRequired) {
        return true;
      }

      this._authRequired = true;

      if (status.authenticated) {
        this._authenticated = true;
        this._showLogoutButton();
        return true;
      }

      // Try silent re-login with saved credentials before showing overlay
      const saved = this._loadSavedCreds();
      if (saved && (await this._login(saved, { silent: true }))) {
        return true;
      }

      this._showLoginOverlay(status.methods || [], saved);
      return false; // block app init until authenticated
    } catch (e) {
      console.warn('Auth status check failed, proceeding without auth:', e);
      return true;
    }
  }

  _loadSavedCreds() {
    try {
      const raw = localStorage.getItem(AuthManager.LS_KEY);
      if (!raw) {
        return null;
      }
      const obj = JSON.parse(raw);
      if (obj && (obj.token || (obj.username && obj.password))) {
        return obj;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  _saveCreds(creds) {
    try {
      localStorage.setItem(AuthManager.LS_KEY, JSON.stringify(creds));
    } catch {
      /* ignore */
    }
  }

  _clearSavedCreds() {
    try {
      localStorage.removeItem(AuthManager.LS_KEY);
    } catch {
      /* ignore */
    }
  }

  _showLoginOverlay(methods, saved) {
    const overlay = document.getElementById('authOverlay');
    const appEl = document.querySelector('.app');
    overlay.style.display = 'flex';
    appEl.style.display = 'none';

    const hasToken = methods.includes('token');
    const hasBasic = methods.includes('basic');

    const tokenForm = document.getElementById('authTokenForm');
    const basicForm = document.getElementById('authBasicForm');
    const tabs = document.getElementById('authTabs');

    // Pre-fill from saved credentials (if any)
    if (saved?.token) {
      document.getElementById('authToken').value = saved.token;
    }
    if (saved?.username) {
      document.getElementById('authUsername').value = saved.username;
    }
    if (saved?.password) {
      document.getElementById('authPassword').value = saved.password;
    }

    // If saved creds match a single available method, switch to that tab.
    const preferBasic = saved?.username && hasBasic && !saved?.token;

    if (hasToken && hasBasic) {
      tabs.style.display = 'flex';
      if (preferBasic) {
        tokenForm.style.display = 'none';
        basicForm.style.display = 'flex';
        document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'basic'));
      } else {
        tokenForm.style.display = 'flex';
        basicForm.style.display = 'none';
      }
      this._bindTabs();
    } else if (hasBasic) {
      tokenForm.style.display = 'none';
      basicForm.style.display = 'flex';
    } else {
      tokenForm.style.display = 'flex';
      basicForm.style.display = 'none';
    }

    tokenForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = document.getElementById('authToken').value.trim();
      const remember = document.getElementById('authTokenRemember').checked;
      if (token) {
        this._login({ token }, { remember });
      }
    });

    basicForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('authUsername').value.trim();
      const password = document.getElementById('authPassword').value;
      const remember = document.getElementById('authBasicRemember').checked;
      if (username && password) {
        this._login({ username, password }, { remember });
      }
    });
  }

  _bindTabs() {
    const tabs = document.querySelectorAll('.auth-tab');
    const tokenForm = document.getElementById('authTokenForm');
    const basicForm = document.getElementById('authBasicForm');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'token') {
          tokenForm.style.display = 'flex';
          basicForm.style.display = 'none';
        } else {
          tokenForm.style.display = 'none';
          basicForm.style.display = 'flex';
        }
        this._hideError();
      });
    });
  }

  /**
   * Attempt login. Options:
   *   - silent:   on failure, suppress error UI and return false (used for auto-login)
   *   - remember: on success, persist credentials to localStorage; on omission, leave LS untouched
   *
   * Returns true on success, false on failure.
   */
  async _login(credentials, { silent = false, remember } = {}) {
    if (!silent) {
      this._hideError();
    }
    try {
      const resp = await apiFetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!resp.ok) {
        if (silent) {
          this._clearSavedCreds();
          return false;
        }
        const err = await resp.json().catch(() => ({}));
        this._showError(err.error || 'Authentication failed');
        return false;
      }

      this._authenticated = true;

      if (remember === true) {
        this._saveCreds(credentials);
      } else if (remember === false) {
        this._clearSavedCreds();
      }

      // Hide overlay, show app
      document.getElementById('authOverlay').style.display = 'none';
      document.querySelector('.app').style.display = 'flex';
      this._showLogoutButton();

      // Initialize the main app after successful login
      window.mcpAgentTester = new McpAgentTester();
      return true;
    } catch (_e) {
      if (!silent) {
        this._showError('Connection error');
      }
      return false;
    }
  }

  _showLogoutButton() {
    const btn = document.getElementById('logoutBtn');
    if (btn) {
      btn.style.display = '';
      btn.addEventListener('click', () => this._logout());
    }
  }

  async _logout() {
    this._clearSavedCreds();
    try {
      await apiFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    location.reload();
  }

  _showError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.style.display = 'block';
  }

  _hideError() {
    const el = document.getElementById('authError');
    el.style.display = 'none';
  }
}

/**
 * Minimal MCP Apps host-side bridge for a single rendered widget. Owns one
 * iframe, runs the JSON-RPC postMessage handshake (`ui/initialize` →
 * `ui/notifications/initialized`), streams the captured tool I/O into the
 * View, resizes the iframe on `ui/notifications/size-changed`, and proxies
 * View→Host calls back through callbacks supplied by the host.
 *
 * Operates in desktop-style mode (proposal §6.1): single iframe on the same
 * origin, CSP applied via `<meta http-equiv>` inside `srcdoc`. We accept the
 * documented trade-off that meta-CSP is theoretically bypassable for a
 * dev-tool.
 */
class AppWidgetBridge {
  constructor(appCall, hostContext, callbacks) {
    this.appCall = appCall;
    this.hostContext = hostContext;
    this.callbacks = callbacks || {};
    this.iframe = null;
    this.state = 'idle';
    this.viewProtocolVersion = null;
    this.viewAppCapabilities = null;
    this._listener = null;
    this._pendingPostInit = false;
  }

  mount(container) {
    this.iframe = this._createIframe();
    container.appendChild(this.iframe);
    this._listener = (e) => this._onMessage(e);
    window.addEventListener('message', this._listener);
    this.state = 'mounted';
  }

  destroy() {
    if (this._listener) {
      window.removeEventListener('message', this._listener);
      this._listener = null;
    }
    if (this.iframe?.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.iframe = null;
    this.state = 'destroyed';
  }

  setTheme(themeName) {
    this.hostContext.theme = { name: themeName };
    this._notify('ui/notifications/host-context-changed', { theme: this.hostContext.theme });
  }

  _createIframe() {
    const ui = this.appCall.uiResource;
    const iframe = document.createElement('iframe');
    iframe.className = 'app-widget-iframe';
    iframe.setAttribute('data-call-id', this.appCall.callId);
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    const allow = this._buildPermissionPolicy(ui?.meta?.permissions);
    if (allow) {
      iframe.setAttribute('allow', allow);
    }
    iframe.srcdoc = this._wrapHtml(ui.text, this._buildCspMeta(ui?.meta?.csp));
    iframe.style.width = '100%';
    iframe.style.minHeight = '180px';
    iframe.style.border = ui?.meta?.prefersBorder ? '1px solid var(--border)' : 'none';
    return iframe;
  }

  _wrapHtml(html, cspMeta) {
    if (!cspMeta) {
      return html;
    }
    // Inject CSP meta as early as possible so it applies to inline scripts.
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>\n${cspMeta}`);
    }
    if (/<html[^>]*>/i.test(html)) {
      return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${cspMeta}</head>`);
    }
    return `<!DOCTYPE html><html><head>${cspMeta}</head><body>${html}</body></html>`;
  }

  _buildCspMeta(csp) {
    const directives = [
      "default-src 'none'",
      `script-src ${this._cspList(['self', 'unsafe-inline', ...(csp?.resourceDomains || [])])}`,
      `style-src ${this._cspList(['self', 'unsafe-inline', ...(csp?.resourceDomains || [])])}`,
      `img-src ${this._cspList(['self', 'data:', ...(csp?.resourceDomains || [])])}`,
      `media-src ${this._cspList(['self', 'data:', ...(csp?.resourceDomains || [])])}`,
      `font-src ${this._cspList(['self', 'data:', ...(csp?.resourceDomains || [])])}`,
      `connect-src ${this._cspList(['self', ...(csp?.connectDomains || [])])}`,
      `frame-src ${this._cspList(csp?.frameDomains || [], "'none'")}`,
      `base-uri ${this._cspList(csp?.baseUriDomains || ['self'])}`,
    ];
    return `<meta http-equiv="Content-Security-Policy" content="${this._escapeAttr(directives.join('; '))}">`;
  }

  _cspList(items, fallback) {
    if (!items || items.length === 0) {
      return fallback || "'self'";
    }
    return items.map((d) => (d === 'self' || d === 'unsafe-inline' || d === 'data:' ? `'${d}'` : d)).join(' ');
  }

  _buildPermissionPolicy(permissions) {
    if (!permissions) {
      return null;
    }
    const out = [];
    if (permissions.camera) {
      out.push('camera');
    }
    if (permissions.microphone) {
      out.push('microphone');
    }
    if (permissions.geolocation) {
      out.push('geolocation');
    }
    if (permissions.clipboardWrite) {
      out.push('clipboard-write');
    }
    return out.join('; ');
  }

  _escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  _onMessage(event) {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      return;
    }
    if (this.callbacks.onJsonRpcMessage) {
      this.callbacks.onJsonRpcMessage('view→host', msg, this.appCall);
    }
    if (typeof msg.method === 'string') {
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    const m = msg.method;
    switch (m) {
      case 'ui/initialize':
        this._respond(msg.id, this._buildInitializeResult(msg.params));
        return;
      case 'ui/notifications/initialized':
        this.state = 'ready';
        this._sendToolIO();
        return;
      case 'ui/notifications/size-changed':
        this._handleSizeChange(msg.params);
        return;
      case 'ui/notifications/log':
      case 'notifications/message':
        if (this.callbacks.onLog) {
          this.callbacks.onLog(msg.params, this.appCall);
        }
        return;
      case 'ui/open-link':
        this._handleOpenLink(msg);
        return;
      case 'ui/message':
        this._handleViewMessage(msg);
        return;
      case 'ui/update-model-context':
        this._handleUpdateModelContext(msg);
        return;
      case 'ui/request-display-mode':
        this._respond(msg.id, { displayMode: 'inline' });
        return;
      case 'tools/call':
      case 'ui/request-call-tool':
        this._handleViewCallTool(msg);
        return;
      default:
        // Notifications without a handler are silently accepted; requests must
        // get a method-not-found error so the View's JSON-RPC stub resolves.
        if (typeof msg.id !== 'undefined') {
          this._respondError(msg.id, -32601, `Method not found: ${m}`);
        }
    }
  }

  _respond(id, result) {
    if (typeof id === 'undefined' || !this.iframe?.contentWindow) {
      return;
    }
    const reply = { jsonrpc: '2.0', id, result };
    if (this.callbacks.onJsonRpcMessage) {
      this.callbacks.onJsonRpcMessage('host→view', reply, this.appCall);
    }
    this.iframe.contentWindow.postMessage(reply, '*');
  }

  _respondError(id, code, message) {
    if (typeof id === 'undefined' || !this.iframe?.contentWindow) {
      return;
    }
    const reply = { jsonrpc: '2.0', id, error: { code, message } };
    if (this.callbacks.onJsonRpcMessage) {
      this.callbacks.onJsonRpcMessage('host→view', reply, this.appCall);
    }
    this.iframe.contentWindow.postMessage(reply, '*');
  }

  _notify(method, params) {
    if (!this.iframe?.contentWindow) {
      return;
    }
    const msg = { jsonrpc: '2.0', method, params };
    if (this.callbacks.onJsonRpcMessage) {
      this.callbacks.onJsonRpcMessage('host→view', msg, this.appCall);
    }
    this.iframe.contentWindow.postMessage(msg, '*');
  }

  _buildInitializeResult(reqParams) {
    this.viewProtocolVersion = reqParams?.protocolVersion || null;
    this.viewAppCapabilities = reqParams?.appCapabilities || null;
    return {
      protocolVersion: this.viewProtocolVersion || '2026-01-26',
      hostInfo: { name: 'fa-mcp-sdk:agent-tester', version: this.hostContext.hostVersion || '1.0.0' },
      hostCapabilities: {
        openLinks: {},
        logging: {},
        serverTools: { listChanged: false },
        sampling: {},
      },
      hostContext: {
        theme: this.hostContext.theme || { name: 'light' },
        displayMode: 'inline',
        containerType: 'inline',
        availableDisplayModes: ['inline'],
      },
    };
  }

  _sendToolIO() {
    this._notify('ui/notifications/tool-input', {
      toolName: this.appCall.toolName,
      arguments: this.appCall.arguments || {},
    });
    this._notify('ui/notifications/tool-result', this.appCall.result);
  }

  _handleSizeChange(params) {
    const h = Number(params?.height);
    if (Number.isFinite(h) && h > 0 && this.iframe) {
      this.iframe.style.height = Math.min(Math.max(h, 80), 1600) + 'px';
    }
  }

  _handleOpenLink(msg) {
    const url = msg.params?.url;
    if (typeof url === 'string') {
      try {
        const u = new URL(url, window.location.href);
        if (['http:', 'https:', 'mailto:'].includes(u.protocol)) {
          window.open(u.href, '_blank', 'noopener,noreferrer');
        }
      } catch {
        /* ignore invalid url */
      }
    }
    this._respond(msg.id, {});
  }

  _handleViewMessage(msg) {
    if (this.callbacks.onViewMessage) {
      this.callbacks.onViewMessage(msg.params, this.appCall);
    }
    this._respond(msg.id, {});
  }

  _handleUpdateModelContext(msg) {
    if (this.callbacks.onUpdateModelContext) {
      this.callbacks.onUpdateModelContext(msg.params, this.appCall);
    }
    this._respond(msg.id, {});
  }

  async _handleViewCallTool(msg) {
    if (!this.callbacks.onViewCallTool) {
      // Stage 8 wires this up; until then refuse politely.
      this._respondError(msg.id, -32601, 'View→Host tool calls not enabled');
      return;
    }
    try {
      const result = await this.callbacks.onViewCallTool(msg.params, this.appCall);
      this._respond(msg.id, result);
    } catch (e) {
      this._respondError(msg.id, -32000, e?.message || 'Tool call failed');
    }
  }
}

class McpAgentTester {
  constructor() {
    this.currentSessionId = null;
    this.currentServer = null;
    this.currentSystemPrompt = '';
    this.usedHeaders = [];
    this.pendingConnectionData = null;
    this._headersUpdateTimer = null;
    this._headersApplyPromise = null;
    this.defaultMcpUrl = null;
    this.authEnabled = false;
    this.configHttpHeaders = {};
    this._authRefreshTimer = null;
    this._authTtlSec = null;
    this._authVisibilityListenerAttached = false;
    this._authRefreshInFlight = false;
    this._currentAuthType = null;
    this.messageFormats = {};
    this.messageTexts = {};
    this.defaultDisplayFormat = localStorage.getItem('agentTesterDefaultFormat') || 'HTML';
    this.appMode = localStorage.getItem('agentTesterAppMode') === 'true';
    this.activeAppWidgets = [];
    this.maxLiveWidgets = 5;
    this.uiMessageLog = [];
    this.maxUiMessageLog = 500;
    this._viewCallToolAllowed = false;

    this.mcpConfig = {
      url: null,
      transport: 'http',
      headers: {},
      name: null,
      appMode: this.appMode,
    };

    this.initializeElements();
    this.initTheme();
    this.bindEvents();
    this.loadInitialData();

    this.setupAutoResize();

    console.log('MCP Agent Tester initialized');
  }

  sanitizeHtml(html) {
    const allowedTags = new Set([
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'code',
      'pre',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ]);

    const allowedAttributes = {
      a: ['href', 'title', 'target'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      code: ['class'],
      pre: ['class'],
      span: ['class'],
      div: ['class'],
    };

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const cleanNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      const tagName = node.tagName.toLowerCase();

      if (!allowedTags.has(tagName)) {
        // noinspection UnnecessaryLocalVariableJS
        const textNode = document.createTextNode(node.textContent || '');
        return textNode;
      }

      const cleanedElement = document.createElement(tagName);

      const allowedAttrs = allowedAttributes[tagName] || [];
      allowedAttrs.forEach((attr) => {
        if (node.hasAttribute(attr)) {
          const value = node.getAttribute(attr);
          if (attr === 'href') {
            try {
              const url = new URL(value, window.location.href);
              if (['http:', 'https:', 'mailto:'].includes(url.protocol)) {
                cleanedElement.setAttribute(attr, value);
              }
            } catch {
              // Invalid URL, skip
            }
          } else {
            cleanedElement.setAttribute(attr, value);
          }
        }
      });

      Array.from(node.childNodes).forEach((child) => {
        const cleanedChild = cleanNode(child);
        if (cleanedChild) {
          cleanedElement.appendChild(cleanedChild);
        }
      });

      return cleanedElement;
    };

    const cleanedNodes = Array.from(tempDiv.childNodes)
      .map(cleanNode)
      .filter((node) => node !== null);

    const finalDiv = document.createElement('div');
    cleanedNodes.forEach((node) => finalDiv.appendChild(node));

    return finalDiv.innerHTML.trim();
  }

  createFormatToggle(messageId) {
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'format-toggle-container';

    const select = document.createElement('select');
    select.className = 'format-toggle';
    select.dataset.messageId = messageId;
    select.setAttribute('data-testid', 'at-message-format-toggle');

    const options = ['MD', 'HTML'];
    const currentFormat = this.messageFormats[messageId] || 'MD';

    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === currentFormat) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      this.onFormatChange(messageId, e.target.value);
    });

    toggleContainer.appendChild(select);
    return toggleContainer;
  }

  onFormatChange(messageId, format) {
    this.messageFormats[messageId] = format;
    const originalText = this.messageTexts[messageId];
    const messageText = document.querySelector(`.message-text[data-message-id="${messageId}"]`);
    if (messageText && originalText) {
      this.renderMessageContent(messageText, originalText, format);
    }
  }

  handleDefaultFormatChange() {
    const { value } = this.defaultFormatSelect;
    this.defaultDisplayFormat = value;
    localStorage.setItem('agentTesterDefaultFormat', value);
    if (value === 'HTML') {
      this.showToast('Tip: add "Format your response in HTML" to Custom Prompt for best results', 'info');
    }
  }

  /**
   * Toggle MCP Apps mode. Persists the flag, updates the active mcpConfig, and
   * if the server is connected reconnects so the new capability set is sent on
   * the next `initialize` handshake. All rendered widget iframes are cleared
   * because their capability context just changed.
   */
  async handleAppModeToggle() {
    const next = !!this.appModeToggle.checked;
    this.appMode = next;
    this.mcpConfig.appMode = next;
    localStorage.setItem('agentTesterAppMode', next ? 'true' : 'false');

    this.clearLiveAppWidgets();

    if (this.currentServer && this.currentServer.isConnected) {
      try {
        await this.handleReconnect();
        this.showToast(next ? 'MCP Apps mode: ON — reconnected' : 'MCP Apps mode: OFF — reconnected', 'success');
      } catch (e) {
        console.warn('Reconnect after appMode toggle failed:', e);
        this.showToast('Reconnect failed: ' + (e?.message || e), 'error');
      }
    } else {
      this.showToast(next ? 'MCP Apps mode enabled' : 'MCP Apps mode disabled', 'info');
    }

    this.refreshToolListAppIcons();
    this.applyAppModeVisibility();
  }

  /**
   * Show the Inspector tab only while MCP Apps mode is ON. When the mode is
   * turned off while the Inspector tab is active, fall back to the Chat tab so
   * the user is not left on a hidden pane.
   */
  applyAppModeVisibility() {
    const appEl = document.querySelector('.app');
    if (appEl) {
      appEl.classList.toggle('apps-mode-on', !!this.appMode);
    }
    if (!this.appMode && this.activeTab === 'inspector') {
      this.switchTab('chat');
    }
  }

  /**
   * Spec §6.8: MCP Apps mode requires HTTP/SSE. Agent-tester currently only
   * exposes HTTP/SSE transports in the UI, so this is a no-op stub kept for
   * future STDIO transport support.
   */
  updateAppModeToggleAvailability() {
    if (!this.appModeToggleLabel) {
      return;
    }
    const transport = this.transportSelect?.value || 'http';
    const supported = transport === 'http' || transport === 'sse';
    this.appModeToggleLabel.classList.toggle('is-disabled', !supported);
    if (this.appModeToggle) {
      this.appModeToggle.disabled = !supported;
    }
  }

  clearLiveAppWidgets() {
    for (const entry of this.activeAppWidgets) {
      try {
        entry.bridge.destroy();
      } catch (e) {
        console.warn('Bridge destroy failed:', e);
      }
      if (entry.container?.parentNode) {
        entry.container.parentNode.removeChild(entry.container);
      }
    }
    this.activeAppWidgets = [];
  }

  /**
   * Mount an `AppWidgetBridge` for a single appCall and return the container
   * the message renderer should drop into the DOM. Honors the live-widget
   * cap from proposal §6.2 by demoting the oldest widget to a static
   * "poster" once the limit is exceeded.
   */
  renderAppWidget(appCall, messageId) {
    const container = document.createElement('div');
    container.className = 'app-widget-container';
    container.dataset.callId = appCall.callId;
    container.dataset.messageId = messageId;

    const header = document.createElement('div');
    header.className = 'app-widget-header';
    header.innerHTML = `
      <span class="material-icons-round app-widget-icon">grid_view</span>
      <span class="app-widget-title">${this._escapeHtml(appCall.toolName)}</span>
      <button type="button" class="app-widget-collapse btn-icon" title="Collapse">
        <span class="material-icons-round">expand_less</span>
      </button>
    `;
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'app-widget-body';
    container.appendChild(body);

    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const bridge = new AppWidgetBridge(
      appCall,
      { theme: { name: theme }, hostVersion: this.sdkVersion || '0.0.0' },
      {
        onJsonRpcMessage: (direction, msg) => this._logUiMessage(direction, msg, appCall),
        onViewCallTool: (params, ac) => this._proxyViewCallTool(params, ac),
        onLog: (params, ac) => this._logUiMessage('log', { method: 'notifications/message', params }, ac),
        onViewMessage: (params, ac) => this._logUiMessage('msg', { method: 'ui/message', params }, ac),
        onUpdateModelContext: (params, ac) =>
          this._logUiMessage('ctx', { method: 'ui/update-model-context', params }, ac),
      },
    );
    bridge.mount(body);

    const entry = { callId: appCall.callId, messageId, bridge, container };
    this.activeAppWidgets.push(entry);
    this._enforceWidgetCap();

    header.querySelector('.app-widget-collapse').addEventListener('click', () => {
      const collapsed = container.classList.toggle('is-collapsed');
      const icon = header.querySelector('.app-widget-collapse .material-icons-round');
      if (icon) {
        icon.textContent = collapsed ? 'expand_more' : 'expand_less';
      }
    });

    return container;
  }

  _enforceWidgetCap() {
    while (this.activeAppWidgets.length > this.maxLiveWidgets) {
      const oldest = this.activeAppWidgets.shift();
      if (!oldest) {
        break;
      }
      try {
        oldest.bridge.destroy();
      } catch {
        /* ignore */
      }
      if (oldest.container) {
        oldest.container.classList.add('is-poster');
        const body = oldest.container.querySelector('.app-widget-body');
        if (body) {
          body.innerHTML =
            '<div class="app-widget-poster">Widget unloaded (live-widget cap reached). Reload page to re-render.</div>';
        }
      }
    }
  }

  _logUiMessage(direction, msg, appCall) {
    const entry = {
      timestamp: new Date().toISOString(),
      direction,
      callId: appCall?.callId || null,
      toolName: appCall?.toolName || null,
      method: msg?.method || (typeof msg?.id !== 'undefined' ? 'response' : 'unknown'),
      msg,
    };
    this.uiMessageLog.push(entry);
    if (this.uiMessageLog.length > this.maxUiMessageLog) {
      this.uiMessageLog.splice(0, this.uiMessageLog.length - this.maxUiMessageLog);
    }
    this._broadcastUiLogEntry(entry);
  }

  _broadcastUiLogEntry(_entry) {
    if (this.activeTab === 'inspector') {
      this.renderInspectorLog();
    }
  }

  /**
   * Repaint the entire Inspector pane: app-tools list, UI resources, and the
   * live `ui/*` JSON-RPC log. Called on tab activation and on the manual
   * refresh button.
   */
  async refreshInspector() {
    this.renderInspectorTools();
    this.renderInspectorLog();
    await this.refreshInspectorResources();
  }

  renderInspectorTools() {
    if (!this.inspectorToolsList) {
      return;
    }
    this.inspectorToolsList.innerHTML = '';
    const tools = (this.currentServer?.isConnected && this.currentServer.tools) || [];
    if (tools.length === 0) {
      this.inspectorToolsList.innerHTML = '<li class="inspector-empty">No connected server</li>';
      return;
    }
    for (const t of tools) {
      const hasUi = this._toolHasUi(t);
      const li = document.createElement('li');
      li.className = hasUi ? 'inspector-tool has-ui' : 'inspector-tool';
      li.innerHTML = `
        <div class="inspector-tool-head">
          <span class="material-icons-round inspector-tool-icon">${hasUi ? 'grid_view' : 'build'}</span>
          <code>${this._escapeHtml(t.name)}</code>
          ${hasUi ? '<span class="inspector-tool-flag">UI</span>' : ''}
        </div>
        <div class="inspector-tool-desc">${this._escapeHtml(t.description || '')}</div>
        ${hasUi ? '<button type="button" class="btn btn-secondary inspector-launch">Launch widget</button>' : ''}
      `;
      const btn = li.querySelector('.inspector-launch');
      if (btn) {
        btn.addEventListener('click', () => this._launchInspectorWidget(t));
      }
      this.inspectorToolsList.appendChild(li);
    }
  }

  async refreshInspectorResources() {
    if (!this.inspectorResourcesList) {
      return;
    }
    if (!this.currentServer?.isConnected) {
      this.inspectorResourcesList.innerHTML = '<li class="inspector-empty">No connected server</li>';
      return;
    }
    this.inspectorResourcesList.innerHTML = '<li class="inspector-empty">Loading…</li>';
    try {
      const resp = await apiFetch(
        `${API_BASE}/api/mcp/ui-resources?serverName=${encodeURIComponent(this.currentServer.name)}`,
      );
      const data = await resp.json();
      const list = Array.isArray(data.resources) ? data.resources : [];
      if (list.length === 0) {
        this.inspectorResourcesList.innerHTML = '<li class="inspector-empty">No UI resources registered</li>';
        return;
      }
      this.inspectorResourcesList.innerHTML = '';
      for (const r of list) {
        const li = document.createElement('li');
        li.className = 'inspector-resource';
        li.innerHTML = `
          <div class="inspector-tool-head">
            <span class="material-icons-round inspector-tool-icon">code</span>
            <code>${this._escapeHtml(r.uri || '')}</code>
          </div>
          <div class="inspector-tool-desc">${this._escapeHtml(r.name || r.description || '')}</div>
          <div class="inspector-tool-mime">${this._escapeHtml(r.mimeType || '')}</div>
        `;
        this.inspectorResourcesList.appendChild(li);
      }
    } catch (e) {
      this.inspectorResourcesList.innerHTML = `<li class="inspector-empty">Error: ${this._escapeHtml(e?.message || e)}</li>`;
    }
  }

  renderInspectorLog() {
    if (!this.inspectorLog) {
      return;
    }
    const filter = this.inspectorLogFilter?.value || '';
    const entries = filter
      ? this.uiMessageLog.filter((e) => e.direction === filter || e.direction.startsWith(filter))
      : this.uiMessageLog;
    if (entries.length === 0) {
      this.inspectorLog.textContent = '(no ui/* messages yet)';
      return;
    }
    const lines = entries.slice(-200).map((e) => {
      const tag = this._escapeHtml(e.direction);
      const tool = this._escapeHtml(e.toolName || '-');
      const method = this._escapeHtml(e.method || '-');
      const shortMsg = JSON.stringify(e.msg).slice(0, 400);
      return `[${e.timestamp.slice(11, 19)}] ${tag.padEnd(28)} ${tool} ${method} ${this._escapeHtml(shortMsg)}`;
    });
    this.inspectorLog.textContent = lines.join('\n');
    this.inspectorLog.scrollTop = this.inspectorLog.scrollHeight;
  }

  /**
   * Direct widget-only smoke test — invoke a tool without involving the LLM
   * and mount the returned UI resource in a dedicated modal. Useful for
   * iterating on widget HTML in isolation.
   */
  async _launchInspectorWidget(tool) {
    if (!this.currentServer?.isConnected) {
      this.showToast('Connect to an MCP server first', 'error');
      return;
    }
    const args = prompt(`Arguments JSON for ${tool.name}:`, '{}');
    if (args === null) {
      return;
    }
    let parsed;
    try {
      parsed = args.trim() ? JSON.parse(args) : {};
    } catch (e) {
      this.showToast('Invalid JSON: ' + e.message, 'error');
      return;
    }

    await this.flushPendingHeaders();

    try {
      const resp = await apiFetch(`${API_BASE}/api/mcp/call-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: this.currentServer.name,
          toolName: tool.name,
          parameters: parsed,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        this.showToast('Tool call failed: ' + (data?.error || resp.status), 'error');
        return;
      }
      if (!data.uiResource) {
        this.showToast('Tool returned no UI resource', 'info');
        return;
      }
      this._openWidgetModal(tool.name, parsed, data.result, data.uiResource);
    } catch (e) {
      this.showToast('Widget launch failed: ' + (e?.message || e), 'error');
    }
  }

  _openWidgetModal(toolName, args, result, uiResource) {
    let modal = document.getElementById('inspectorWidgetModal');
    if (modal) {
      modal.remove();
    }
    modal = document.createElement('div');
    modal.id = 'inspectorWidgetModal';
    modal.className = 'inspector-modal-overlay';
    modal.innerHTML = `
      <div class="inspector-modal">
        <header>
          <span class="material-icons-round">grid_view</span>
          <strong>${this._escapeHtml(toolName)}</strong>
          <button type="button" class="btn-icon inspector-modal-close" title="Close">
            <span class="material-icons-round">close</span>
          </button>
        </header>
        <div class="inspector-modal-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.inspector-modal-close').addEventListener('click', () => {
      if (this._inspectorBridge) {
        try {
          this._inspectorBridge.destroy();
        } catch {
          /* ignore */
        }
        this._inspectorBridge = null;
      }
      modal.remove();
    });

    const appCall = {
      callId: `inspector-${Date.now()}`,
      toolName,
      arguments: args || {},
      result,
      uiResource,
    };
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const bridge = new AppWidgetBridge(
      appCall,
      { theme: { name: theme }, hostVersion: this.sdkVersion || '0.0.0' },
      {
        onJsonRpcMessage: (direction, msg) => this._logUiMessage(direction, msg, appCall),
        onViewCallTool: (params, ac) => this._proxyViewCallTool(params, ac),
        onLog: (params, ac) => this._logUiMessage('log', { method: 'notifications/message', params }, ac),
      },
    );
    bridge.mount(modal.querySelector('.inspector-modal-body'));
    this._inspectorBridge = bridge;
  }

  /**
   * Proxy View → Host `tools/call`. Per proposal §6.4, the first view-initiated
   * call in a session pops a confirm modal; the user MAY persist consent for
   * the rest of the session via `sessionStorage`. All calls are logged as
   * `view→host:call-tool` for the App Inspector.
   */
  async _proxyViewCallTool(params, appCall) {
    const toolName = params?.name || params?.toolName;
    if (!toolName || typeof toolName !== 'string') {
      throw new Error('Missing tool name');
    }
    const args = params?.arguments || params?.args || {};

    this._logUiMessage(
      'view→host:call-tool',
      { method: 'tools/call', params: { name: toolName, arguments: args } },
      appCall,
    );

    if (!(await this._confirmViewCallTool(toolName, appCall))) {
      throw new Error('User denied widget tool call');
    }

    if (!this.currentServer || !this.currentServer.isConnected) {
      throw new Error('No MCP server connected');
    }

    const response = await apiFetch(`${API_BASE}/api/mcp/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverName: this.currentServer.name,
        toolName,
        parameters: args,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      const errMsg = data?.error || `HTTP ${response.status}`;
      this._logUiMessage(
        'host→view:call-tool-error',
        { method: 'tools/call', error: errMsg, params: { name: toolName } },
        appCall,
      );
      throw new Error(errMsg);
    }

    this._logUiMessage(
      'host→view:call-tool-result',
      { method: 'tools/call', params: { name: toolName }, result: data.result },
      appCall,
    );
    return data.result;
  }

  async _confirmViewCallTool(toolName, appCall) {
    const SESSION_KEY = 'agentTesterAppWidgetConsent';
    try {
      if (sessionStorage.getItem(SESSION_KEY) === 'allow') {
        return true;
      }
    } catch {
      /* sessionStorage may be unavailable in private mode */
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'app-widget-confirm-overlay';
      overlay.innerHTML = `
        <div class="app-widget-confirm">
          <h3>Widget action requested</h3>
          <p>Widget for <code>${this._escapeHtml(appCall.toolName)}</code> wants to call tool
             <strong>${this._escapeHtml(toolName)}</strong> on the connected MCP server.</p>
          <label class="app-widget-remember">
            <input type="checkbox" id="appWidgetConsentRemember">
            <span>Don't ask again in this session</span>
          </label>
          <div class="app-widget-confirm-actions">
            <button type="button" class="btn" data-action="deny">Deny</button>
            <button type="button" class="btn btn-primary" data-action="allow">Allow</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const remember = overlay.querySelector('#appWidgetConsentRemember');
      const finish = (allowed) => {
        if (allowed && remember?.checked) {
          try {
            sessionStorage.setItem(SESSION_KEY, 'allow');
          } catch {
            /* ignore */
          }
        }
        overlay.remove();
        resolve(allowed);
      };
      overlay.addEventListener('click', (e) => {
        const action = e.target?.closest?.('button')?.dataset?.action;
        if (action === 'allow') {
          finish(true);
        } else if (action === 'deny' || e.target === overlay) {
          finish(false);
        }
      });
    });
  }

  _escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  }

  /**
   * Placeholder hook — populated in the Tool Tester stage with logic that adds
   * a "has UI" icon to app-tools in the dropdown when appMode is ON.
   */
  refreshToolListAppIcons() {
    if (this.ttToolSelect && Array.isArray(this.ttTools)) {
      this.refreshToolList();
    }
  }

  renderMessageContent(element, text, format) {
    if (format === 'HTML') {
      element.innerHTML = this.sanitizeHtml(text).trim();
      element.classList.add('html-content');
      element.classList.remove('md-content');
    } else {
      element.textContent = text;
      element.classList.add('md-content');
      element.classList.remove('html-content');
    }
  }

  initializeElements() {
    this.mcpConnectionForm = document.getElementById('mcpConnectionForm');
    this.serverUrlInput = document.getElementById('serverUrl');
    this.transportSelect = document.getElementById('transport');
    this.connectionToggleBtn = document.getElementById('connectionToggleBtn');

    this.serverUrlDropdown = document.getElementById('serverUrlDropdown');
    this.serverUrlDropdownList = document.getElementById('serverUrlDropdownList');
    this.savedUrlsList = document.getElementById('savedUrlsList');

    this.currentServer = null;

    this.headersSection = document.getElementById('headersSection');
    this.dynamicHeaders = document.getElementById('dynamicHeaders');

    // LLM settings — collapsed view + modal
    this.modelDisplay = document.getElementById('modelDisplay');
    this.llmSettingsBtn = document.getElementById('llmSettingsBtn');
    this.apiKeyWarning = document.getElementById('apiKeyWarning');
    this.llmModal = document.getElementById('llmModal');
    this.llmModalClose = document.getElementById('llmModalClose');
    this.llmModalCancel = document.getElementById('llmModalCancel');
    this.llmModalSave = document.getElementById('llmModalSave');
    this.llmApiKeyToggle = document.getElementById('llmApiKeyToggle');
    this.llmBaseUrl = document.getElementById('llmBaseUrl');
    this.llmApiKey = document.getElementById('llmApiKey');
    this.llmModelName = document.getElementById('llmModelName');
    this.llmModelDropdownToggle = document.getElementById('llmModelDropdownToggle');
    this.llmModelDropdownList = document.getElementById('llmModelDropdownList');
    this.llmTemperature = document.getElementById('llmTemperature');
    this.llmMaxTokens = document.getElementById('llmMaxTokens');
    this.llmMaxTurns = document.getElementById('llmMaxTurns');
    this.llmLimitChars = document.getElementById('llmLimitChars');

    this.llmSettings = { ...LLM_DEFAULTS };

    this.systemPromptTextarea = document.getElementById('systemPrompt');
    this.customPromptTextarea = document.getElementById('customPrompt');
    this.btnResetAgentPrompt = document.getElementById('btnResetAgentPrompt');
    this.btnViewOriginalPrompt = document.getElementById('btnViewOriginalPrompt');
    this.promptModifiedBadge = document.getElementById('promptModifiedBadge');
    this.originalAgentPrompt = null;

    this.chatMessages = document.getElementById('chatMessages');
    this.messageInput = document.getElementById('messageInput');
    this.sendButton = document.getElementById('sendButton');
    this.clearChatBtn = document.getElementById('clearChat');
    this.connectionStatus = document.getElementById('connectionStatus');
    this.charCount = document.getElementById('charCount');
    this.typingIndicator = document.getElementById('typingIndicator');

    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.toastContainer = document.getElementById('toastContainer');

    this.themeToggle = document.getElementById('themeToggle');
    this.defaultFormatSelect = document.getElementById('defaultDisplayFormat');
    this.appModeToggle = document.getElementById('appModeToggle');
    this.appModeToggleLabel = document.getElementById('appModeToggleLabel');

    // App Inspector tab elements
    this.inspectorToolsList = document.getElementById('inspectorToolsList');
    this.inspectorResourcesList = document.getElementById('inspectorResourcesList');
    this.inspectorLog = document.getElementById('inspectorLog');
    this.inspectorLogFilter = document.getElementById('inspectorLogFilter');
    this.inspectorLogClear = document.getElementById('inspectorLogClear');
    this.inspectorRefreshBtn = document.getElementById('inspectorRefreshBtn');

    // Tool Tester tab elements
    this.tabsBar = document.querySelector('.tabs-bar');
    this.tabPaneChat = document.getElementById('tabPaneChat');
    this.tabPaneToolTester = document.getElementById('tabPaneToolTester');
    this.ttLayout = document.getElementById('ttLayout');
    this.ttToolSelect = document.getElementById('ttToolSelect');
    this.ttToolDescription = document.getElementById('ttToolDescription');
    this.ttSchemaToggle = document.getElementById('ttSchemaToggle');
    this.ttSchemaPanel = document.getElementById('ttSchemaPanel');
    this.ttSchemaContent = document.getElementById('ttSchemaContent');
    this.ttSchemaClose = document.getElementById('ttSchemaClose');
    this.ttGenerateJson = document.getElementById('ttGenerateJson');
    this.ttValidateJson = document.getElementById('ttValidateJson');
    this.ttRequestJson = document.getElementById('ttRequestJson');
    this.ttSendBtn = document.getElementById('ttSendBtn');
    this.ttRequestStatus = document.getElementById('ttRequestStatus');
    this.ttResponseContent = document.getElementById('ttResponseContent');
    this.ttResponseClear = document.getElementById('ttResponseClear');
    this.ttResponseTextView = document.getElementById('ttResponseTextView');
    this.ttLastResult = null;
    this.ttResponseTextMode = false;
    this.activeTab = 'chat';
  }

  bindEvents() {
    if (this.themeToggle) {
      this.themeToggle.addEventListener('click', () => this.toggleTheme());
    }

    if (this.defaultFormatSelect) {
      this.defaultFormatSelect.value = this.defaultDisplayFormat;
      this.defaultFormatSelect.addEventListener('change', () => this.handleDefaultFormatChange());
    }

    if (this.appModeToggle) {
      this.appModeToggle.checked = this.appMode;
      this.appModeToggle.addEventListener('change', () => this.handleAppModeToggle());
      this.updateAppModeToggleAvailability();
    }
    this.applyAppModeVisibility();

    this.mcpConnectionForm.addEventListener('submit', (e) => this.handleMcpConnection(e));

    this.serverUrlInput.addEventListener('input', () => this.handleServerUrlChange());
    this.transportSelect.addEventListener('change', () => {
      this.saveFormValuesToStorage();
      this.updateAppModeToggleAvailability();
    });

    this.serverUrlDropdown.addEventListener('click', (e) => this.toggleUrlDropdown(e));
    document.addEventListener('click', (e) => this.handleClickOutside(e));

    this.systemPromptTextarea.addEventListener('input', () => {
      this.saveFormValuesToStorage();
      this.updatePromptModifiedState();
    });
    this.customPromptTextarea.addEventListener('input', () => this.saveFormValuesToStorage());
    this.btnResetAgentPrompt.addEventListener('click', () => this.resetAgentPrompt());
    this.btnViewOriginalPrompt.addEventListener('click', () => this.viewOriginalPrompt());

    // LLM settings modal
    this.llmSettingsBtn.addEventListener('click', () => this.openLlmModal());
    this.llmModalClose.addEventListener('click', () => this.closeLlmModal());
    this.llmModalCancel.addEventListener('click', () => this.closeLlmModal());
    this.llmModalSave.addEventListener('click', () => this.saveLlmModal());
    this.llmApiKeyToggle.addEventListener('click', () => this.toggleApiKeyVisibility());
    this.llmModelDropdownToggle.addEventListener('click', (e) => this.toggleLlmModelDropdown(e));
    this.renderLlmModelDropdown();
    this.llmModal.addEventListener('click', (e) => {
      if (e.target === this.llmModal) {
        this.closeLlmModal();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.llmModal.style.display === 'flex') {
        this.closeLlmModal();
      }
    });

    document.querySelectorAll('.btn-enlarge').forEach((btn) => {
      btn.addEventListener('click', () => this.openPromptModal(btn.dataset.target));
    });
    document.getElementById('promptModalClose').addEventListener('click', () => this.closePromptModal());
    document.getElementById('promptModalSave').addEventListener('click', () => this.savePromptModal());
    document.getElementById('promptModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.closePromptModal();
      }
    });

    this.messageInput.addEventListener('input', () => this.handleInputChange());
    this.messageInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.sendButton.addEventListener('click', () => this.sendMessage());
    this.clearChatBtn.addEventListener('click', () => this.clearChat());

    const sdkVersionBtn = document.getElementById('sdkVersionBtn');
    if (sdkVersionBtn) {
      sdkVersionBtn.addEventListener('click', (e) => this.toggleSdkVersionTooltip(e));
    }

    // --- Tool Tester tab events ---
    if (this.tabsBar) {
      this.tabsBar.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
      });
    }
    if (this.ttToolSelect) {
      this.ttToolSelect.addEventListener('change', () => this.handleToolSelectionChange());
    }
    if (this.ttSchemaToggle) {
      this.ttSchemaToggle.addEventListener('click', () => this.toggleSchemaPanel());
    }
    if (this.ttSchemaClose) {
      this.ttSchemaClose.addEventListener('click', () => this.toggleSchemaPanel(false));
    }
    if (this.ttGenerateJson) {
      this.ttGenerateJson.addEventListener('click', () => this.generateJsonSkeleton());
    }
    if (this.ttValidateJson) {
      this.ttValidateJson.addEventListener('click', () => this.validateRequestJson());
    }
    if (this.ttRequestJson) {
      this.ttRequestJson.addEventListener('input', () => this.handleRequestJsonInput());
    }
    if (this.ttSendBtn) {
      this.ttSendBtn.addEventListener('click', () => this.sendToolRequest());
    }
    if (this.ttResponseClear) {
      this.ttResponseClear.addEventListener('click', () => this.clearToolResponse());
    }
    if (this.ttResponseTextView) {
      this.ttResponseTextView.addEventListener('click', () => this.toggleResponseTextMode());
    }

    if (this.inspectorRefreshBtn) {
      this.inspectorRefreshBtn.addEventListener('click', () => this.refreshInspector());
    }
    if (this.inspectorLogClear) {
      this.inspectorLogClear.addEventListener('click', () => {
        this.uiMessageLog = [];
        this.renderInspectorLog();
      });
    }
    if (this.inspectorLogFilter) {
      this.inspectorLogFilter.addEventListener('change', () => this.renderInspectorLog());
    }
  }

  initTheme() {
    const saved = localStorage.getItem('mcpAgentTheme');
    let theme = saved;
    if (!theme) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    this.applyTheme(theme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
    localStorage.setItem('mcpAgentTheme', next);
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    for (const entry of this.activeAppWidgets || []) {
      try {
        entry.bridge.setTheme(theme);
      } catch {
        /* widget already torn down */
      }
    }
    if (this.themeToggle) {
      const icon = this.themeToggle.querySelector('.material-icons-round');
      if (icon) {
        icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
      }
    }
  }

  openPromptModal(targetId) {
    this._promptModalTarget = document.getElementById(targetId);
    const modal = document.getElementById('promptModal');
    const textarea = document.getElementById('promptModalTextarea');
    const title = document.getElementById('promptModalTitle');
    title.textContent = targetId === 'systemPrompt' ? 'Agent Prompt' : 'Custom Prompt';
    textarea.value = this._promptModalTarget.value;
    modal.style.display = 'flex';
    textarea.focus();
  }

  closePromptModal() {
    const modal = document.getElementById('promptModal');
    const textarea = document.getElementById('promptModalTextarea');
    const saveBtn = document.getElementById('promptModalSave');
    modal.style.display = 'none';
    if (this._viewOriginalMode) {
      textarea.readOnly = false;
      saveBtn.style.display = '';
      this._viewOriginalMode = false;
    }
    this._promptModalTarget = null;
  }

  savePromptModal() {
    if (this._promptModalTarget) {
      this._promptModalTarget.value = document.getElementById('promptModalTextarea').value;
      this.saveFormValuesToStorage();
    }
    this.closePromptModal();
  }

  setupAutoResize() {
    this.messageInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 240) + 'px';
    });
  }

  async loadInitialData() {
    try {
      this.loadFormValuesFromStorage();
      this.loadFormValuesFromURL();
      this.handleServerUrlChange();
      this.renderSavedUrls();
      await this.loadDefaultConfig();
      this.initLlmSettings();
      await this.loadCurrentServer();
      this.currentSystemPrompt = this.systemPromptTextarea.value;

      const serverUrl = this.serverUrlInput.value.trim();
      if (serverUrl && (!this.currentServer || !this.currentServer.isConnected)) {
        // Auto-connect if there's a URL but no connected server
        await this.autoConnect();
      } else if (serverUrl && this.currentServer && this.currentServer.isConnected) {
        // Already connected — still need to load headers
        await this.checkRequiredHeaders();
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  }

  async autoConnect() {
    const serverUrl = this.serverUrlInput.value.trim();
    if (!serverUrl) {
      return;
    }

    const transport = this.transportSelect.value;
    const serverName = this.generateServerName(serverUrl);

    const connectionData = {
      name: serverName,
      url: serverUrl,
      transport: transport,
      headers: this.getHeadersFromForm(),
      appMode: this.appMode,
    };

    this.showLoading('Auto-connecting to MCP server...');

    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionData),
      });

      const result = await response.json();

      if (result.success) {
        this.currentServer = {
          name: serverName,
          url: serverUrl,
          isConnected: true,
          ...result.config,
        };

        this.mcpConfig = {
          url: serverUrl,
          transport: transport,
          headers: this.getHeadersFromForm(),
          name: serverName,
          appMode: this.appMode,
        };

        if (result.config && result.config.agentPrompt) {
          this.systemPromptTextarea.value = result.config.agentPrompt;
          this.currentSystemPrompt = result.config.agentPrompt;
          this.originalAgentPrompt = result.config.agentPrompt;
          this.updateResetPromptButton();
        }

        this.addUrlToSaved(serverUrl);
        this.headersSection.style.display = 'none';
        this.dynamicHeaders.innerHTML = '';
        this.usedHeaders = [];
        this.updateConnectionStatus();
        this.renderServerInfo();

        await this.checkRequiredHeaders();

        this.showToast('Auto-connected to ' + serverName, 'success');
      } else {
        console.warn('Auto-connect failed:', result.error);
      }
    } catch (error) {
      console.warn('Auto-connect failed:', error.message);
    } finally {
      this.hideLoading();
    }
  }

  async loadDefaultConfig() {
    try {
      const response = await apiFetch(`${API_BASE}/api/config`);
      const config = await response.json();
      this.defaultMcpUrl = config.defaultMcpUrl || null;
      this.authEnabled = !!config.authEnabled;
      this.configHttpHeaders = config.httpHeaders || {};
      this.llmDefaults = config.llmDefaults || {};
      this.sdkVersion = config.sdkVersion || '';
      if (config.defaultMcpUrl) {
        const serverUrlInput = document.getElementById('serverUrl');
        if (!this.mcpConfig.url && !serverUrlInput.value) {
          serverUrlInput.value = config.defaultMcpUrl;
        }
      }
    } catch (e) {
      console.warn('Failed to load default config:', e);
    }
  }

  async handleMcpConnection(event) {
    event.preventDefault();

    // Combined Connect/Disconnect button: disconnect when already connected
    if (this.currentServer && this.currentServer.isConnected) {
      await this.disconnectServer();
      return;
    }

    const serverUrl = this.serverUrlInput.value.trim();
    const transport = this.transportSelect.value;

    const serverName = this.generateServerName(serverUrl);

    const connectionData = {
      name: serverName,
      url: serverUrl,
      transport: transport,
      headers: this.getHeadersFromForm(),
      appMode: this.appMode,
    };

    this.showLoading('Connecting to MCP server...');

    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionData),
      });

      const result = await response.json();

      if (result.success) {
        this.currentServer = {
          name: serverName,
          url: serverUrl,
          isConnected: true,
          ...result.config,
        };

        this.mcpConfig = {
          url: serverUrl,
          transport: transport,
          headers: this.getHeadersFromForm(),
          name: serverName,
          appMode: this.appMode,
        };

        if (result.config && result.config.agentPrompt) {
          this.systemPromptTextarea.value = result.config.agentPrompt;
          this.currentSystemPrompt = result.config.agentPrompt;
          this.originalAgentPrompt = result.config.agentPrompt;
          this.updateResetPromptButton();
        }

        this.showToast('Successfully connected to ' + serverName, 'success');

        this.addUrlToSaved(serverUrl);

        this.headersSection.style.display = 'none';
        this.dynamicHeaders.innerHTML = '';
        this.usedHeaders = [];

        this.updateConnectionStatus();
        this.renderServerInfo();

        await this.checkRequiredHeaders();
      } else {
        this.showToast('Failed to connect: ' + result.error, 'error');
      }
    } catch (error) {
      console.error('Connection error:', error);
      this.showToast('Connection failed: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  generateServerName(url) {
    try {
      const parsedUrl = new URL(url);
      const { hostname, port } = parsedUrl;

      let serverName = hostname;
      serverName = serverName.replace(/^www\./, '').split('.')[0] || 'MCP Server';

      if (port && port !== '80' && port !== '443') {
        serverName += ':' + port;
      }
      return serverName;
    } catch {
      return url.split('/')[2] || 'MCP Server';
    }
  }

  async checkRequiredHeaders() {
    const url = this.serverUrlInput.value.trim();

    if (!url) {
      this.showToast('Please enter a server URL first', 'warning');
      return;
    }

    this.showLoading('Checking used headers...');

    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/used-headers?url=${encodeURIComponent(url)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const headers = await response.json();
        this.usedHeaders = Array.isArray(headers) ? headers : [];
        this.renderHeaderInputs();
        await this.autoFillAuthHeader();

        if (this.usedHeaders.length > 0) {
          const reqCount = this.usedHeaders.filter((h) => !h.isOptional).length;
          this.showToast(`Found ${this.usedHeaders.length} headers (${reqCount} used)`, 'success');
          this.headersSection.style.display = 'block';
        } else {
          this.showToast('No additional headers used', 'info');
          this.headersSection.style.display = 'none';
        }
      } else {
        this.showToast('Headers endpoint not available - proceeding without additional headers', 'info');
        this.headersSection.style.display = 'none';
        this.usedHeaders = [];
      }
    } catch (error) {
      console.log('Headers check failed:', error);
      this.showToast('Headers endpoint not available - proceeding without additional headers', 'info');
      this.headersSection.style.display = 'none';
      this.usedHeaders = [];
    } finally {
      this.hideLoading();
    }
  }

  renderHeaderInputs() {
    this.dynamicHeaders.innerHTML = '';
    const savedHeaders = this.loadHeaderValuesFromStorage();

    this.usedHeaders.forEach((header) => {
      const headerGroup = document.createElement('div');
      headerGroup.className = 'header-row';

      const savedValue = savedHeaders[header.name] || this.configHttpHeaders[header.name] || '';
      const isRequired = !header.isOptional;
      const hasDesc = header.description && header.description.trim();
      const nameClass = hasDesc ? 'header-name has-tooltip' : 'header-name';
      const tooltipAttr = hasDesc ? ` data-tooltip="${header.description.replace(/"/g, '&quot;')}"` : '';
      const inputClass = isRequired ? 'header-value used-header' : 'header-value';

      headerGroup.setAttribute('data-testid', `at-header-row-${header.name}`);
      headerGroup.innerHTML = `
                <span class="${nameClass}"${tooltipAttr}>${header.name}</span>
                <input
                    type="text"
                    class="${inputClass}"
                    id="header_${header.name}"
                    placeholder="${header.name}"
                    data-header-name="${header.name}"
                    data-required="${isRequired}"
                    data-testid="at-header-input-${header.name}"
                    value="${savedValue.replace(/"/g, '&quot;')}"
                >
            `;

      this.dynamicHeaders.appendChild(headerGroup);

      const nameEl = headerGroup.querySelector('.header-name');
      if (nameEl) {
        nameEl.style.cursor = 'pointer';
        let hoverTimer = null;
        if (hasDesc) {
          nameEl.addEventListener('mouseenter', (e) => {
            hoverTimer = setTimeout(() => this.showHeaderTooltip(e, header.description), 1000);
          });
          nameEl.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            this.hideHeaderTooltip();
          });
        }
        nameEl.addEventListener('click', (e) => {
          e.stopPropagation();
          clearTimeout(hoverTimer);
          this.hideHeaderTooltip();
          this.copyToClipboard(header.name).then(() => {
            this.showToast(`Copied: ${header.name}`, 'success');
          });
        });
      }

      const inputEl = headerGroup.querySelector(`#header_${header.name}`);
      if (inputEl) {
        inputEl.addEventListener('input', () => {
          this.saveHeaderValuesToStorage();
          this.scheduleHeadersUpdate();
          this.updateHeaderBorder(inputEl);
        });
        this.updateHeaderBorder(inputEl);
      }
    });

    this.mcpConfig.headers = this.getHeadersFromForm();
  }

  showHeaderTooltip(e, text) {
    const tip = document.getElementById('headerTooltip');
    tip._sourceEl = e.target;
    tip.textContent = text;
    const rect = e.target.getBoundingClientRect();
    tip.style.left = rect.left + 'px';
    tip.style.top = rect.top - 4 + 'px';
    tip.style.transform = 'translateY(-100%)';
    tip.classList.add('visible');
  }

  hideHeaderTooltip() {
    const tip = document.getElementById('headerTooltip');
    tip.classList.remove('visible');
    tip._sourceEl = null;
  }

  toggleSdkVersionTooltip(e) {
    e.stopPropagation();
    const tip = document.getElementById('headerTooltip');
    const btn = e.currentTarget;
    if (tip._sourceEl === btn && tip.classList.contains('visible')) {
      this.hideHeaderTooltip();
      return;
    }
    const text = this.sdkVersion ? `fa-mcp-sdk v${this.sdkVersion}` : 'fa-mcp-sdk (version unknown)';
    tip._sourceEl = btn;
    tip.textContent = text;
    const rect = btn.getBoundingClientRect();
    tip.style.left = rect.left + rect.width / 2 + 'px';
    tip.style.top = rect.bottom + 6 + 'px';
    tip.style.transform = 'translateX(-50%)';
    tip.classList.add('visible');
    if (!this._sdkTooltipOutsideHandler) {
      this._sdkTooltipOutsideHandler = (ev) => {
        if (ev.target !== btn && !btn.contains(ev.target)) {
          this.hideHeaderTooltip();
        }
      };
      document.addEventListener('click', this._sdkTooltipOutsideHandler);
    }
  }

  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => this._fallbackCopy(text));
    }
    return this._fallbackCopy(text);
  }

  _fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  updateHeaderBorder(inputEl) {
    if (inputEl.dataset.required === 'true') {
      if (inputEl.value.trim()) {
        inputEl.classList.remove('empty-required');
      } else {
        inputEl.classList.add('empty-required');
      }
    }
  }

  getHeaderStorageKey() {
    const url = this.serverUrlInput.value.trim();
    return `mcpHeaderValues_${url}`;
  }

  saveHeaderValuesToStorage() {
    const headers = this.getHeadersFromForm();
    const key = this.getHeaderStorageKey();
    try {
      localStorage.setItem(key, JSON.stringify(headers));
    } catch (error) {
      console.error('Error saving header values to storage:', error);
    }
  }

  loadHeaderValuesFromStorage() {
    const key = this.getHeaderStorageKey();
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error loading header values from storage:', error);
      return {};
    }
  }

  scheduleHeadersUpdate() {
    this.mcpConfig.headers = this.getHeadersFromForm();

    if (this._headersUpdateTimer) {
      clearTimeout(this._headersUpdateTimer);
    }
    this._headersUpdateTimer = setTimeout(() => {
      this._headersUpdateTimer = null;
      this._runHeadersUpdate();
    }, 600);
  }

  _runHeadersUpdate() {
    this._headersApplyPromise = this.applyHeadersUpdate()
      .catch((err) => console.warn('Apply headers failed:', err))
      .finally(() => {
        this._headersApplyPromise = null;
      });
    return this._headersApplyPromise;
  }

  // Flush any pending (debounced or in-flight) header update so a direct tool
  // call sees the latest header values on the server. Without this, a fast
  // "Send Request" click races the 600 ms debounce and the call goes out with
  // the previously applied (or empty) headers — e.g. a missing
  // x-on-behalf-of-user yields MISSING_USER_IDENTITY.
  async flushPendingHeaders() {
    if (this._headersUpdateTimer) {
      clearTimeout(this._headersUpdateTimer);
      this._headersUpdateTimer = null;
      this._runHeadersUpdate();
    }
    if (this._headersApplyPromise) {
      await this._headersApplyPromise;
    }
  }

  async applyHeadersUpdate() {
    if (!this.currentServer || !this.currentServer.name) {
      return;
    }
    const headers = this.getHeadersFromForm();
    try {
      const resp = await apiFetch(`${API_BASE}/api/mcp/headers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: this.currentServer.name, headers }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        this.showToast('Failed to apply headers: ' + (data.error || resp.statusText), 'error');
        return;
      }
      if (data.config) {
        this.currentServer = { ...this.currentServer, ...data.config };
        this.renderServerInfo();
      }
      this.showToast('Headers applied', 'success');
    } catch (e) {
      this.showToast('Failed to apply headers: ' + (e?.message || e), 'error');
    }
  }

  getHeadersFromForm() {
    const headers = {};

    if (this.usedHeaders.length === 0) {
      return headers;
    }

    this.usedHeaders.forEach((header) => {
      const input = document.getElementById(`header_${header.name}`);
      if (input && input.value.trim()) {
        headers[header.name] = input.value.trim();
      }
    });

    return headers;
  }

  isOwnService() {
    if (!this.defaultMcpUrl) {
      return false;
    }
    const current = this.serverUrlInput?.value?.trim();
    if (!current) {
      return false;
    }
    const norm = (s) => {
      try {
        const u = new URL(s, window.location.origin);
        const host = u.hostname.toLowerCase();
        const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
        // Treat any localhost variant as the same host on the same port.
        const canonicalHost = localHosts.has(host) ? 'localhost' : host;
        const port = u.port || (u.protocol === 'https:' ? '443' : '80');
        const path = u.pathname.replace(/\/+$/, '');
        return `${u.protocol}//${canonicalHost}:${port}${path}`;
      } catch {
        return s;
      }
    };
    return norm(current) === norm(this.defaultMcpUrl);
  }

  async autoFillAuthHeader() {
    if (!this.authEnabled) {
      return;
    }

    const hasAuthHeader = this.usedHeaders.some((h) => h.name === 'Authorization');
    if (!hasAuthHeader) {
      return;
    }

    const savedHeaders = this.loadHeaderValuesFromStorage();

    try {
      const response = await apiFetch(`${API_BASE}/api/auth-token`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      this._currentAuthType = data.authType;

      // For non-JWT auth, keep user's saved value if any.
      // JWT must always be refreshed (short-lived, regenerated on page reload).
      if (data.authType !== 'jwtToken' && savedHeaders['Authorization']) {
        return;
      }

      const input = document.getElementById('header_Authorization');
      if (input) {
        input.value = data.token;
        this.updateHeaderBorder(input);
        this.saveHeaderValuesToStorage();
        this.scheduleHeadersUpdate();
      }

      // Start JWT refresh interval if connecting to own service
      if (data.authType === 'jwtToken' && this.isOwnService()) {
        this.startAuthRefresh(data.ttlSec);
      }
    } catch (e) {
      console.warn('Failed to auto-fill auth header:', e);
    }
  }

  // Compute the delay (ms) until the next refresh: ~1/3 of TTL minus a 60s safety window.
  // Math.max(30, ...) clamps against negative or too-short delays when ttl/3 - 60 <= 30.
  _refreshDelayMs(ttlSec) {
    const ttl = Number(ttlSec);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return 3 * 60 * 1000;
    }
    return Math.max(30, ttl / 3 - 60) * 1000;
  }

  startAuthRefresh(ttlSec) {
    this.stopAuthRefresh();
    if (ttlSec) {
      this._authTtlSec = Number(ttlSec);
    }
    this._scheduleNextRefresh(this._refreshDelayMs(this._authTtlSec));
    this._attachAuthVisibilityListeners();
  }

  _scheduleNextRefresh(delayMs) {
    if (this._authRefreshTimer) {
      clearTimeout(this._authRefreshTimer);
    }
    this._authRefreshTimer = setTimeout(() => {
      this._authRefreshTimer = null;
      this._doRefreshAuthToken().finally(() => {
        // Reschedule even if the refresh failed — TTL hasn't necessarily expired yet,
        // and the next attempt may succeed (e.g., transient network blip).
        if (this._authTtlSec) {
          this._scheduleNextRefresh(this._refreshDelayMs(this._authTtlSec));
        }
      });
    }, delayMs);
  }

  async _doRefreshAuthToken() {
    if (this._authRefreshInFlight) {
      return;
    }
    this._authRefreshInFlight = true;
    try {
      const response = await apiFetch(`${API_BASE}/api/auth-token/refresh`, { method: 'POST' });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data.ttlSec) {
        this._authTtlSec = Number(data.ttlSec);
      }
      const input = document.getElementById('header_Authorization');
      if (input) {
        input.value = data.token;
        this.saveHeaderValuesToStorage();
        this.scheduleHeadersUpdate();
      }
    } catch (e) {
      console.warn('Failed to refresh auth token:', e);
    } finally {
      this._authRefreshInFlight = false;
    }
  }

  _attachAuthVisibilityListeners() {
    if (this._authVisibilityListenerAttached) {
      return;
    }
    this._authVisibilityListenerAttached = true;
    const handler = () => {
      // Background-tab throttling can starve setTimeout — refresh eagerly when the user comes back.
      if (document.visibilityState !== 'visible') {
        return;
      }
      if (this._currentAuthType !== 'jwtToken') {
        return;
      }
      if (!this.isOwnService()) {
        return;
      }
      this._doRefreshAuthToken().finally(() => {
        if (this._authTtlSec) {
          this._scheduleNextRefresh(this._refreshDelayMs(this._authTtlSec));
        }
      });
    };
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
  }

  stopAuthRefresh() {
    if (this._authRefreshTimer) {
      clearTimeout(this._authRefreshTimer);
      this._authRefreshTimer = null;
    }
  }

  resetConnectionForm() {
    this.stopAuthRefresh();
    this.mcpConnectionForm.reset();
    this.serverUrlInput.value = '';
    this.transportSelect.value = 'http';
    this.headersSection.style.display = 'none';
    this.dynamicHeaders.innerHTML = '';
    this.usedHeaders = [];
    this.pendingConnectionData = null;
    this.mcpConfig = {
      url: null,
      transport: 'http',
      headers: {},
      name: null,
      appMode: this.appMode,
    };
    this.originalAgentPrompt = null;
    this.updateResetPromptButton();
    window.history.replaceState({}, document.title, window.location.pathname);
    localStorage.removeItem('mcpAgentFormValues');
  }

  async loadCurrentServer() {
    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/servers`);
      const servers = await response.json();

      if (servers && servers.length > 0) {
        this.currentServer = servers[0];
        // Restore mcpConfig from the backend-held connection. Without this, after a
        // page reload the server stays connected on the backend (so Tool Tester works),
        // but this.mcpConfig.url is null, so the Chat path sends mcpConfig: undefined
        // and the LLM receives zero tools (logs show "Tools: 0" / "MCP Server: None").
        if (this.currentServer.isConnected) {
          this.mcpConfig = {
            url: this.currentServer.url,
            transport: this.currentServer.transport,
            headers: this.currentServer.headers || {},
            name: this.currentServer.name,
            appMode: this.appMode,
          };
        }
        this.updateConnectionStatus();
        this.renderServerInfo();
      } else {
        this.currentServer = null;
        this.updateConnectionStatus();
        this.renderServerInfo();
      }
    } catch (error) {
      console.error('Error loading current server:', error);
      this.currentServer = null;
      this.updateConnectionStatus();
      this.renderServerInfo();
    }
  }

  renderServerInfo() {
    this.refreshToolList();
    this.updateConnectionToggleBtn();
  }

  updateConnectionToggleBtn() {
    const btn = this.connectionToggleBtn;
    if (!btn) {
      return;
    }
    const iconEl = btn.querySelector('.connect-icon');
    const countEl = btn.querySelector('.tools-count');
    const connected = !!(this.currentServer && this.currentServer.isConnected);

    if (connected) {
      const toolCount = Array.isArray(this.currentServer.tools) ? this.currentServer.tools.length : 0;
      btn.classList.add('connected');
      btn.classList.remove('disconnected');
      btn.title = `Disconnect (${toolCount} tools)`;
      btn.setAttribute('aria-label', 'Disconnect');
      if (iconEl) {
        iconEl.textContent = 'stop';
      }
      if (countEl) {
        countEl.textContent = `${toolCount} tools`;
      }
    } else {
      btn.classList.add('disconnected');
      btn.classList.remove('connected');
      btn.title = 'Connect';
      btn.setAttribute('aria-label', 'Connect');
      if (iconEl) {
        iconEl.textContent = 'play_arrow';
      }
      if (countEl) {
        countEl.textContent = '';
      }
    }
  }

  async disconnectServer() {
    if (!this.currentServer) {
      return;
    }

    this.stopAuthRefresh();

    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/disconnect/${this.currentServer.name}`, { method: 'POST' });

      if (response.ok) {
        this.showToast(`Disconnected from ${this.currentServer.name}`, 'success');
        this.currentServer = null;
        this.mcpConfig = {
          url: null,
          transport: 'http',
          headers: {},
          name: null,
          appMode: this.appMode,
        };
        this.originalAgentPrompt = null;
        this.updateResetPromptButton();
        await this.loadCurrentServer();
        this.updateConnectionStatus();
      } else {
        this.showToast('Failed to disconnect', 'error');
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      this.showToast('Disconnect failed: ' + error.message, 'error');
    }
  }

  async handleReconnect() {
    if (!this.currentServer) {
      return;
    }

    const connectionData = {
      name: this.currentServer.name,
      url: this.currentServer.url,
      transport: this.currentServer.transport || 'http',
      headers: this.currentServer.headers || {},
      appMode: this.appMode,
    };

    this.showLoading('Reconnecting to MCP server...');

    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionData),
      });

      if (response.ok) {
        const result = await response.json();
        this.currentServer = {
          ...connectionData,
          isConnected: true,
          tools: result.tools || [],
        };

        this.showToast(`Reconnected to ${this.currentServer.name}`, 'success');
        await this.loadCurrentServer();
        this.updateConnectionStatus();
      } else {
        const errorText = await response.text();
        this.showToast(`Reconnection failed: ${errorText}`, 'error');
      }
    } catch (error) {
      console.error('Reconnect error:', error);
      this.showToast('Reconnection failed: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  updateConnectionStatus() {
    if (!this.connectionStatus) {
      return;
    }
    if (this.currentServer && this.currentServer.isConnected) {
      this.connectionStatus.textContent = `Connected to ${this.currentServer.name}`;
      this.connectionStatus.classList.add('connected');
    } else {
      this.connectionStatus.textContent = 'Not Connected';
      this.connectionStatus.classList.remove('connected');
    }
  }

  handleInputChange() {
    const { length } = this.messageInput.value;
    this.charCount.textContent = `${length}/40000`;

    const isEmpty = this.messageInput.value.trim() === '';
    this.sendButton.disabled = isEmpty;

    if (length >= 3800) {
      this.charCount.style.color = '#e74c3c';
    } else if (length >= 3500) {
      this.charCount.style.color = '#f39c12';
    } else {
      this.charCount.style.color = '#95a5a6';
    }
  }

  handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  async sendMessage() {
    const message = this.messageInput.value.trim();
    if (!message) {
      return;
    }

    if (!this.validateLlmSettings()) {
      return;
    }

    this.addMessage(message, 'user');

    this.messageInput.value = '';
    this.handleInputChange();
    this.messageInput.style.height = 'auto';

    this.showTypingIndicator();

    try {
      const modelConfig = this.getModelConfig();

      const requestData = {
        message: message,
        sessionId: this.currentSessionId,
        agentPrompt: trim(this.systemPromptTextarea.value) || undefined,
        customPrompt: trim(this.customPromptTextarea.value) || undefined,
        model: modelConfig.model,
        useStreaming: false,
        mcpConfig: this.mcpConfig.url
          ? {
              url: this.mcpConfig.url,
              transport: this.mcpConfig.transport,
              headers: this.mcpConfig.headers,
              name: this.mcpConfig.name,
              appMode: this.appMode,
            }
          : undefined,
        modelConfig: modelConfig,
        appMode: this.appMode,
      };

      const response = await apiFetch(`${API_BASE}/api/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      this.currentSessionId = result.sessionId;

      // appCalls[] arrives only in MCP Apps mode. Forward to the renderer
      // alongside the assistant message so the widget shows up next to its
      // text body.
      const metadata = result.metadata || {};
      if (Array.isArray(result.appCalls) && result.appCalls.length > 0) {
        metadata.appCalls = result.appCalls;
      }
      this.addMessage(result.message, 'assistant', metadata);
    } catch (error) {
      console.error('Send message error:', error);
      this.addMessage(`Error: ${error.message}`, 'assistant', { error: true });
      this.showToast('Failed to send message: ' + error.message, 'error');
    } finally {
      this.hideTypingIndicator();
    }
  }

  addMessage(text, sender, metadata = {}) {
    const messageId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.dataset.messageId = messageId;
    messageDiv.setAttribute('data-testid', `at-message-${sender}`);

    if (metadata.error) {
      messageDiv.classList.add('error');
    }

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML =
      sender === 'user'
        ? '<span class="material-icons-round">person</span>'
        : '<span class="material-icons-round">smart_toy</span>';

    const content = document.createElement('div');
    content.className = 'message-content';

    if (sender === 'assistant' && !metadata.error) {
      this.messageFormats[messageId] = this.defaultDisplayFormat;
      this.messageTexts[messageId] = text;

      const formatToggle = this.createFormatToggle(messageId);
      content.appendChild(formatToggle);
    }

    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.dataset.messageId = messageId;
    messageText.setAttribute('data-testid', `at-message-text-${sender}`);

    if (sender === 'assistant' && !metadata.error) {
      const format = this.messageFormats[messageId];
      this.renderMessageContent(messageText, text, format);
    } else {
      messageText.textContent = text;
    }

    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = new Date().toLocaleTimeString();

    content.appendChild(messageText);
    content.appendChild(messageTime);

    if (sender === 'assistant' && metadata && !metadata.error) {
      if (metadata.tools_used && metadata.tools_used.length > 0) {
        const toolsUsed = document.createElement('div');
        toolsUsed.className = 'message-tools';
        toolsUsed.innerHTML = `<small class="a-info">Tools used: ${metadata.tools_used.join(', ')}</small>`;
        content.appendChild(toolsUsed);
      }

      if (metadata.response_time) {
        const responseTime = document.createElement('div');
        responseTime.className = 'message-timing';
        responseTime.innerHTML = `<small class="a-info">Response time: ${metadata.response_time}ms</small>`;
        content.appendChild(responseTime);
      }

      if (Array.isArray(metadata.appCalls)) {
        for (const appCall of metadata.appCalls) {
          if (!appCall?.uiResource) {
            continue;
          }
          const widgetContainer = this.renderAppWidget(appCall, messageId);
          if (widgetContainer) {
            content.appendChild(widgetContainer);
          }
        }
      }
    }

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);

    if (sender === 'user') {
      messageDiv.addEventListener('dblclick', () => {
        const currentValue = this.messageInput.value;
        const newValue = currentValue ? currentValue + ' ' + text : text;
        this.messageInput.value = newValue;
        this.messageInput.focus();
        this.handleInputChange();
      });
      messageDiv.style.cursor = 'pointer';
      messageDiv.title = 'Double-click to add text to input field';
    }

    this.chatMessages.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showTypingIndicator() {
    this.typingIndicator.classList.add('visible');
  }

  hideTypingIndicator() {
    this.typingIndicator.classList.remove('visible');
  }

  clearChat() {
    this.clearLiveAppWidgets();
    const welcomeMessage = this.chatMessages.querySelector('.message.welcome');
    this.chatMessages.innerHTML = '';
    if (welcomeMessage) {
      this.chatMessages.appendChild(welcomeMessage);
    }

    this.currentSessionId = null;

    this.showToast('Chat cleared', 'success');
  }

  scrollToBottom() {
    setTimeout(() => {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }, 100);
  }

  showLoading(message = 'Loading...') {
    this.loadingOverlay.querySelector('span').textContent = message;
    this.loadingOverlay.style.display = 'flex';
  }

  hideLoading() {
    this.loadingOverlay.style.display = 'none';
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('data-testid', `at-toast-${type}`);

    const icon =
      {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info',
      }[type] || 'info';

    toast.innerHTML = `
            <span class="material-icons-round">${icon}</span>
            <span>${message}</span>
        `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 5000);

    toast.addEventListener('click', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    });
  }

  initLlmSettings() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(LLM_LS_KEY) || '{}');
    } catch {
      stored = {};
    }

    const merged = { ...LLM_DEFAULTS, ...stored };
    const cfg = this.llmDefaults || {};
    let touched = false;

    if (!merged.baseURL && cfg.baseURL) {
      merged.baseURL = cfg.baseURL;
      touched = true;
    }
    if (!merged.apiKey && cfg.apiKey) {
      merged.apiKey = cfg.apiKey;
      touched = true;
    }

    this.llmSettings = merged;

    if (touched) {
      this.saveLlmSettings();
    }

    this.migrateLegacyLlmSettings();
    this.renderModelDisplay();
  }

  migrateLegacyLlmSettings() {
    try {
      const legacy = JSON.parse(localStorage.getItem('mcpAgentFormValues') || '{}');
      let dirty = false;
      const numericFields = new Set(['temperature', 'maxTokens', 'maxTurns', 'toolResultLimitChars']);
      const map = {
        customBaseUrl: 'baseURL',
        customApiKey: 'apiKey',
        customModelName: 'model',
        modelTemperature: 'temperature',
        modelMaxTokens: 'maxTokens',
        modelMaxTurns: 'maxTurns',
        toolResultLimitChars: 'toolResultLimitChars',
      };
      for (const [from, to] of Object.entries(map)) {
        const raw = legacy[from];
        if (raw == null || raw === '') {
          continue;
        }
        const current = this.llmSettings[to];
        const isEmpty = current == null || current === '' || current === LLM_DEFAULTS[to];
        if (!isEmpty) {
          continue;
        }
        const v = numericFields.has(to) ? Number(raw) : raw;
        if (numericFields.has(to) && Number.isNaN(v)) {
          continue;
        }
        this.llmSettings[to] = v;
        dirty = true;
      }
      // Legacy preset model (not 'other'): reuse if current model is still a default
      if (
        legacy.model &&
        legacy.model !== 'other' &&
        (this.llmSettings.model === LLM_DEFAULTS.model || !this.llmSettings.model)
      ) {
        this.llmSettings.model = legacy.model;
        dirty = true;
      }
      if (dirty) {
        this.saveLlmSettings();
        this.renderModelDisplay();
      }
    } catch {
      /* ignore */
    }
  }

  saveLlmSettings() {
    try {
      localStorage.setItem(LLM_LS_KEY, JSON.stringify(this.llmSettings));
    } catch (e) {
      console.error('Failed to save LLM settings:', e);
    }
  }

  renderModelDisplay() {
    const name = trim(this.llmSettings.model) || '—';
    this.modelDisplay.textContent = name;
    this.apiKeyWarning.style.display = this.llmSettings.apiKey ? 'none' : 'block';
  }

  openLlmModal() {
    const s = this.llmSettings;
    this.llmBaseUrl.value = s.baseURL || '';
    this.llmApiKey.value = s.apiKey || '';
    this.llmModelName.value = s.model || '';
    this.llmTemperature.value = s.temperature ?? LLM_DEFAULTS.temperature;
    this.llmMaxTokens.value = s.maxTokens ?? LLM_DEFAULTS.maxTokens;
    this.llmMaxTurns.value = s.maxTurns ?? LLM_DEFAULTS.maxTurns;
    this.llmLimitChars.value = s.toolResultLimitChars ?? LLM_DEFAULTS.toolResultLimitChars;

    // Reset API key visibility to hidden on open
    this.llmApiKey.type = 'password';
    const icon = this.llmApiKeyToggle.querySelector('.material-icons-round');
    if (icon) {
      icon.textContent = 'visibility';
    }

    this.llmModal.style.display = 'flex';
  }

  closeLlmModal() {
    this.closeLlmModelDropdown();
    this.llmModal.style.display = 'none';
  }

  saveLlmModal() {
    const baseURL = trim(this.llmBaseUrl.value);
    const apiKey = trim(this.llmApiKey.value);
    const model = trim(this.llmModelName.value);
    const temperature = parseFloat(this.llmTemperature.value);
    const maxTokens = parseInt(this.llmMaxTokens.value, 10);
    const maxTurns = parseInt(this.llmMaxTurns.value, 10);
    const toolResultLimitChars = parseInt(this.llmLimitChars.value, 10);

    const missing = [];
    if (!model) {
      missing.push('Model Name');
    }
    // baseURL is optional (OpenAI default) — empty means use provider default
    // apiKey intentionally not required here — its absence triggers the red warning instead
    if (Number.isNaN(temperature)) {
      missing.push('Temperature');
    }
    if (!maxTokens) {
      missing.push('Max Tokens');
    }
    if (!maxTurns) {
      missing.push('Max Turns');
    }
    if (!toolResultLimitChars) {
      missing.push('Limit (chars)');
    }

    if (missing.length) {
      this.showToast(`Missing required fields: ${missing.join(', ')}`, 'error');
      return;
    }

    this.llmSettings = { baseURL, apiKey, model, temperature, maxTokens, maxTurns, toolResultLimitChars };
    this.saveLlmSettings();
    this.renderModelDisplay();
    this.closeLlmModal();
    this.showToast('LLM settings saved', 'success');
  }

  toggleApiKeyVisibility() {
    const icon = this.llmApiKeyToggle.querySelector('.material-icons-round');
    if (this.llmApiKey.type === 'password') {
      this.llmApiKey.type = 'text';
      if (icon) {
        icon.textContent = 'visibility_off';
      }
    } else {
      this.llmApiKey.type = 'password';
      if (icon) {
        icon.textContent = 'visibility';
      }
    }
  }

  renderLlmModelDropdown() {
    this.llmModelDropdownList.innerHTML = '';
    LLM_PRESET_MODELS.forEach((name) => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.setAttribute('data-testid', `at-llm-model-option-${name}`);
      item.textContent = name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.llmModelName.value = name;
        this.closeLlmModelDropdown();
      });
      this.llmModelDropdownList.appendChild(item);
    });
  }

  toggleLlmModelDropdown(e) {
    e.preventDefault();
    e.stopPropagation();
    const visible = this.llmModelDropdownList.style.display !== 'none';
    if (visible) {
      this.closeLlmModelDropdown();
    } else {
      this.openLlmModelDropdown();
    }
  }

  openLlmModelDropdown() {
    this.llmModelDropdownList.style.display = 'block';
    this.llmModelDropdownToggle.classList.add('active');
    // Close on outside click (one-shot)
    setTimeout(() => {
      const onDocClick = (ev) => {
        if (!this.llmModelDropdownList.contains(ev.target) && ev.target !== this.llmModelDropdownToggle) {
          this.closeLlmModelDropdown();
          document.removeEventListener('click', onDocClick);
        }
      };
      document.addEventListener('click', onDocClick);
    }, 0);
  }

  closeLlmModelDropdown() {
    this.llmModelDropdownList.style.display = 'none';
    this.llmModelDropdownToggle.classList.remove('active');
  }

  validateLlmSettings() {
    const s = this.llmSettings;
    const missing = [];
    // baseURL is optional — empty means use provider default (OpenAI)
    if (!s.apiKey) {
      missing.push('API Key');
    }
    if (!s.model) {
      missing.push('Model Name');
    }
    if (missing.length) {
      this.showToast(`Cannot send message — missing: ${missing.join(', ')}. Open LLM Settings.`, 'error');
      return false;
    }
    return true;
  }

  getModelConfig() {
    const s = this.llmSettings;
    return {
      baseURL: s.baseURL,
      apiKey: s.apiKey,
      model: s.model,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      maxTurns: s.maxTurns,
      toolResultLimitChars: s.toolResultLimitChars,
    };
  }

  handleServerUrlChange() {
    this.stopAuthRefresh();
    let url = this.serverUrlInput.value.trim();

    if (url) {
      url = url.replace(/\/+$/, '');

      try {
        const parsedUrl = new URL(url);
        if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
          url = url + '/mcp';
        }
      } catch {
        if (!url.includes('/')) {
          url = url + '/mcp';
        } else if (url.endsWith('/')) {
          url = url + 'mcp';
        } else if (!url.split('/').slice(1).join('/')) {
          url = url + '/mcp';
        }
      }

      this.serverUrlInput.value = url;
    }

    this.saveFormValuesToStorage();
  }

  resetAgentPrompt() {
    if (this.originalAgentPrompt) {
      this.systemPromptTextarea.value = this.originalAgentPrompt;
      this.currentSystemPrompt = this.originalAgentPrompt;
      this.saveFormValuesToStorage();
      this.updatePromptModifiedState();
    }
  }

  viewOriginalPrompt() {
    if (!this.originalAgentPrompt) {
      return;
    }
    const modal = document.getElementById('promptModal');
    const textarea = document.getElementById('promptModalTextarea');
    const title = document.getElementById('promptModalTitle');
    const saveBtn = document.getElementById('promptModalSave');
    title.textContent = 'Original Agent Prompt';
    textarea.value = this.originalAgentPrompt;
    textarea.readOnly = true;
    saveBtn.style.display = 'none';
    this._promptModalTarget = null;
    this._viewOriginalMode = true;
    modal.style.display = 'flex';
    textarea.focus();
  }

  updateResetPromptButton() {
    this.btnResetAgentPrompt.style.display = this.originalAgentPrompt ? '' : 'none';
    this.updatePromptModifiedState();
  }

  updatePromptModifiedState() {
    const hasOriginal = !!this.originalAgentPrompt;
    const isModified = hasOriginal && this.systemPromptTextarea.value.trim() !== this.originalAgentPrompt.trim();
    this.promptModifiedBadge.style.display = isModified ? '' : 'none';
    this.btnViewOriginalPrompt.style.display = isModified ? '' : 'none';
    if (isModified) {
      this.systemPromptTextarea.classList.add('prompt-modified');
    } else {
      this.systemPromptTextarea.classList.remove('prompt-modified');
    }
  }

  saveFormValuesToStorage() {
    const formData = {
      serverUrl: this.serverUrlInput.value,
      transport: this.transportSelect.value,
      agentPrompt: trim(this.systemPromptTextarea.value),
      customPrompt: trim(this.customPromptTextarea.value),
    };
    localStorage.setItem('mcpAgentFormValues', JSON.stringify(formData));
  }

  loadFormValuesFromURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      const serverUrl = params.get('serverUrl');
      const transport = params.get('transport');

      if (serverUrl) {
        this.serverUrlInput.value = serverUrl;
      }
      if (transport) {
        this.transportSelect.value = transport;
      }
    } catch (error) {
      console.error('Error loading form values from URL:', error);
    }
  }

  loadFormValuesFromStorage() {
    try {
      const stored = localStorage.getItem('mcpAgentFormValues');
      if (stored) {
        const formData = JSON.parse(stored);
        if (formData.serverUrl) {
          this.serverUrlInput.value = formData.serverUrl;
        }
        if (formData.transport) {
          this.transportSelect.value = formData.transport;
        }
        if (formData.agentPrompt) {
          this.systemPromptTextarea.value = trim(formData.agentPrompt);
        }
        if (formData.customPrompt) {
          this.customPromptTextarea.value = trim(formData.customPrompt);
        }
      }
    } catch (error) {
      console.error('Error loading form values from storage:', error);
    }
  }

  getSavedUrls() {
    try {
      const saved = localStorage.getItem('mcpSavedUrls');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Error loading saved URLs:', error);
      return [];
    }
  }

  saveSavedUrls(urls) {
    try {
      localStorage.setItem('mcpSavedUrls', JSON.stringify(urls));
    } catch (error) {
      console.error('Error saving URLs:', error);
    }
  }

  addUrlToSaved(url) {
    if (!url || url.trim() === '') {
      return;
    }

    url = url.trim();
    let savedUrls = this.getSavedUrls();

    savedUrls = savedUrls.filter((savedUrl) => savedUrl !== url);

    savedUrls.unshift(url);

    savedUrls = savedUrls.slice(0, 10);

    this.saveSavedUrls(savedUrls);
    this.renderSavedUrls();
  }

  removeUrlFromSaved(url) {
    let savedUrls = this.getSavedUrls();
    savedUrls = savedUrls.filter((savedUrl) => savedUrl !== url);
    this.saveSavedUrls(savedUrls);
    this.renderSavedUrls();
  }

  renderSavedUrls() {
    const savedUrls = this.getSavedUrls();
    this.savedUrlsList.innerHTML = '';

    if (savedUrls.length === 0) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'dropdown-item disabled';
      emptyItem.innerHTML = '<span style="color: rgba(255,255,255,0.5);">No saved URLs</span>';
      this.savedUrlsList.appendChild(emptyItem);
      return;
    }

    savedUrls.forEach((url) => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.setAttribute('data-testid', 'at-saved-url-item');

      item.innerHTML = `
        <div class="url-item">
          <span class="url-text" title="${url}" data-testid="at-saved-url-text">${url}</span>
          <button class="delete-btn" title="Delete URL" data-testid="at-saved-url-delete">
            <span class="material-icons-round" style="font-size: 16px;">close</span>
          </button>
        </div>
      `;

      item.querySelector('.url-text').addEventListener('click', () => {
        this.selectUrl(url);
      });

      item.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeUrlFromSaved(url);
      });

      this.savedUrlsList.appendChild(item);
    });
  }

  selectUrl(url) {
    this.serverUrlInput.value = url;
    this.handleServerUrlChange();
    this.closeUrlDropdown();
    this.autoConnect();
  }

  toggleUrlDropdown(e) {
    e.preventDefault();
    e.stopPropagation();

    const isVisible = this.serverUrlDropdownList.style.display !== 'none';

    if (isVisible) {
      this.closeUrlDropdown();
    } else {
      this.openUrlDropdown();
    }
  }

  openUrlDropdown() {
    this.renderSavedUrls();
    this.serverUrlDropdownList.style.display = 'block';
    this.serverUrlDropdown.classList.add('active');

    const addNewItem = this.serverUrlDropdownList.querySelector('.add-new');
    if (addNewItem) {
      addNewItem.addEventListener('click', () => {
        this.addCurrentUrlToSaved();
      });
    }
  }

  closeUrlDropdown() {
    this.serverUrlDropdownList.style.display = 'none';
    this.serverUrlDropdown.classList.remove('active');
  }

  addCurrentUrlToSaved() {
    const currentUrl = this.serverUrlInput.value.trim();
    if (currentUrl) {
      this.addUrlToSaved(currentUrl);
      this.closeUrlDropdown();
      this.showToast('URL added to saved', 'success');
    }
  }

  handleClickOutside(e) {
    const container = e.target.closest('.custom-select-container');
    if (!container) {
      this.closeUrlDropdown();
    }
  }

  // ===== Tool Tester Tab =====

  switchTab(tabName) {
    if (!tabName || tabName === this.activeTab) {
      return;
    }
    this.activeTab = tabName;

    this.tabsBar.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    const appEl = document.querySelector('.app');
    if (appEl) {
      appEl.setAttribute('data-active-tab', tabName);
    }

    const inspectorPane = document.getElementById('tabPaneInspector');
    const hideAll = () => {
      this.tabPaneChat.style.display = 'none';
      this.tabPaneChat.classList.remove('active');
      this.tabPaneToolTester.style.display = 'none';
      this.tabPaneToolTester.classList.remove('active');
      if (inspectorPane) {
        inspectorPane.style.display = 'none';
        inspectorPane.classList.remove('active');
      }
    };
    if (tabName === 'chat') {
      hideAll();
      this.tabPaneChat.style.display = '';
      this.tabPaneChat.classList.add('active');
    } else if (tabName === 'tool-tester') {
      hideAll();
      this.tabPaneToolTester.style.display = '';
      this.tabPaneToolTester.classList.add('active');
      this.refreshToolList();
    } else if (tabName === 'inspector') {
      hideAll();
      if (inspectorPane) {
        inspectorPane.style.display = '';
        inspectorPane.classList.add('active');
      }
      this.refreshInspector();
    }
  }

  refreshToolList() {
    if (!this.ttToolSelect) {
      return;
    }
    const tools =
      this.currentServer && this.currentServer.isConnected && Array.isArray(this.currentServer.tools)
        ? this.currentServer.tools
        : [];
    this.ttTools = tools;

    const previousValue = this.ttToolSelect.value;
    this.ttToolSelect.innerHTML = '<option value="">— select a tool —</option>';
    tools.forEach((tool) => {
      const opt = document.createElement('option');
      opt.value = tool.name;
      const isApp = this._toolHasUi(tool);
      // Prefix with a small marker so the LLM can't disambiguate, but a human
      // reading the dropdown immediately sees which tools ship a widget.
      opt.textContent = this.appMode && isApp ? `🖼  ${tool.name}` : tool.name;
      if (isApp) {
        opt.dataset.hasUi = 'true';
      }
      this.ttToolSelect.appendChild(opt);
    });

    const stillExists = tools.some((t) => t.name === previousValue);
    this.ttToolSelect.value = stillExists ? previousValue : '';
    this.handleToolSelectionChange();
  }

  _toolHasUi(tool) {
    const uri = tool?._meta?.ui?.resourceUri ?? tool?._meta?.['ui/resourceUri'];
    return typeof uri === 'string' && uri.length > 0;
  }

  getSelectedTool() {
    const name = this.ttToolSelect?.value;
    if (!name || !Array.isArray(this.ttTools)) {
      return null;
    }
    return this.ttTools.find((t) => t.name === name) || null;
  }

  handleToolSelectionChange() {
    const tool = this.getSelectedTool();
    const hasTool = !!tool;
    const connected = !!(this.currentServer && this.currentServer.isConnected);

    this.ttSchemaToggle.disabled = !hasTool;
    this.ttGenerateJson.disabled = !hasTool;
    this.ttValidateJson.disabled = !hasTool;
    this.ttSendBtn.disabled = !hasTool || !connected;

    if (tool && tool.description) {
      this.ttToolDescription.textContent = tool.description;
      this.ttToolDescription.style.display = '';
    } else {
      this.ttToolDescription.textContent = '';
      this.ttToolDescription.style.display = 'none';
    }

    if (this.ttSchemaPanel.style.display !== 'none') {
      this.renderSchema(tool);
    }
    this.loadRequestJsonForTool(tool);
    this.ttRequestStatus.textContent = '';
    this.ttRequestStatus.className = 'tt-status';
  }

  getToolJsonStorageKey(toolName) {
    return `mcpAgentTesterToolJson_${toolName}`;
  }

  loadRequestJsonForTool(tool) {
    if (!tool) {
      return;
    }
    try {
      const saved = localStorage.getItem(this.getToolJsonStorageKey(tool.name));
      if (saved !== null) {
        this.ttRequestJson.value = saved;
        return;
      }
    } catch {
      /* ignore */
    }
    this.ttRequestJson.value = '{}';
  }

  saveRequestJsonForTool() {
    const tool = this.getSelectedTool();
    if (!tool) {
      return;
    }
    try {
      localStorage.setItem(this.getToolJsonStorageKey(tool.name), this.ttRequestJson.value);
    } catch {
      /* ignore */
    }
  }

  handleRequestJsonInput() {
    if (this._ttJsonSaveTimer) {
      clearTimeout(this._ttJsonSaveTimer);
    }
    this._ttJsonSaveTimer = setTimeout(() => this.saveRequestJsonForTool(), 600);
  }

  toggleSchemaPanel(forceState) {
    const isOpen = this.ttSchemaPanel.style.display !== 'none';
    const next = typeof forceState === 'boolean' ? forceState : !isOpen;

    this.ttSchemaPanel.style.display = next ? '' : 'none';
    this.ttLayout.dataset.showSchema = next ? 'true' : 'false';

    if (next) {
      this.renderSchema(this.getSelectedTool());
    }
  }

  renderSchema(tool) {
    if (!tool) {
      this.ttSchemaContent.innerHTML = '';
      return;
    }
    const schema = tool.inputSchema || {};
    if (window.prettyPrintJson && typeof window.prettyPrintJson.toHtml === 'function') {
      try {
        this.ttSchemaContent.innerHTML = window.prettyPrintJson.toHtml(schema, { indent: 2 });
        return;
      } catch {
        /* fall back to plain text */
      }
    }
    try {
      this.ttSchemaContent.textContent = JSON.stringify(schema, null, 2);
    } catch {
      this.ttSchemaContent.textContent = String(schema);
    }
  }

  generateJsonSkeleton() {
    const tool = this.getSelectedTool();
    if (!tool) {
      return;
    }
    const skeleton = this.buildSkeletonFromSchema(tool.inputSchema);
    try {
      this.ttRequestJson.value = JSON.stringify(skeleton, null, 2);
    } catch {
      this.ttRequestJson.value = '{}';
    }
    this.saveRequestJsonForTool();
  }

  validateRequestJson() {
    const tool = this.getSelectedTool();
    if (!tool) {
      return;
    }
    const raw = this.ttRequestJson.value.trim();
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      this.ttRequestStatus.textContent = 'Invalid JSON: ' + e.message;
      this.ttRequestStatus.className = 'tt-status tt-status-error';
      return;
    }
    const errors = this.validateAgainstSchema(parsed, tool.inputSchema || {}, '$');
    if (errors.length === 0) {
      this.ttRequestStatus.textContent = '✓ JSON matches schema';
      this.ttRequestStatus.className = 'tt-status tt-status-success';
    } else {
      const preview = errors.slice(0, 5).join('; ');
      const more = errors.length > 5 ? ` (+${errors.length - 5} more)` : '';
      this.ttRequestStatus.textContent = `${errors.length} validation error${errors.length === 1 ? '' : 's'}: ${preview}${more}`;
      this.ttRequestStatus.className = 'tt-status tt-status-error';
    }
  }

  validateAgainstSchema(value, schema, path) {
    const errors = [];
    if (!schema || typeof schema !== 'object') {
      return errors;
    }
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actual = this.jsonTypeOf(value);
      const numericMatch = actual === 'integer' && types.includes('number');
      if (!types.includes(actual) && !numericMatch) {
        errors.push(`${path}: expected ${types.join('|')} but got ${actual}`);
        return errors;
      }
    }
    if (Array.isArray(schema.enum)) {
      const ok = schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
      if (!ok) {
        errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
      }
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: must be <= ${schema.maximum}`);
      }
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
        errors.push(`${path}: must be > ${schema.exclusiveMinimum}`);
      }
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
        errors.push(`${path}: must be < ${schema.exclusiveMaximum}`);
      }
    }
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: minLength ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: maxLength ${schema.maxLength}`);
      }
      if (schema.pattern) {
        try {
          if (!new RegExp(schema.pattern).test(value)) {
            errors.push(`${path}: pattern mismatch`);
          }
        } catch {
          /* ignore invalid pattern */
        }
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(schema.required)) {
        for (const req of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(value, req)) {
            errors.push(`${path}.${req}: required`);
          }
        }
      }
      const props = schema.properties || {};
      for (const [k, v] of Object.entries(value)) {
        if (props[k]) {
          errors.push(...this.validateAgainstSchema(v, props[k], `${path}.${k}`));
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}.${k}: additional property not allowed`);
        }
      }
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: minItems ${schema.minItems}`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: maxItems ${schema.maxItems}`);
      }
      if (schema.items) {
        value.forEach((item, i) => {
          errors.push(...this.validateAgainstSchema(item, schema.items, `${path}[${i}]`));
        });
      }
    }
    return errors;
  }

  jsonTypeOf(v) {
    if (v === null) {
      return 'null';
    }
    if (Array.isArray(v)) {
      return 'array';
    }
    if (typeof v === 'number') {
      return Number.isInteger(v) ? 'integer' : 'number';
    }
    return typeof v;
  }

  buildSkeletonFromSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return {};
    }
    const { type } = schema;

    if (type === 'object' || schema.properties) {
      const props = schema.properties || {};
      const out = {};
      for (const [key, propSchema] of Object.entries(props)) {
        out[key] = this.skeletonValue(propSchema);
      }
      return out;
    }
    return this.skeletonValue(schema);
  }

  skeletonValue(schema) {
    if (!schema || typeof schema !== 'object') {
      return null;
    }
    if (schema.default !== undefined) {
      return schema.default;
    }
    if (Array.isArray(schema.examples) && schema.examples.length) {
      return schema.examples[0];
    }
    if (schema.example !== undefined) {
      return schema.example;
    }
    if (Array.isArray(schema.enum) && schema.enum.length) {
      return schema.enum[0];
    }
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    switch (type) {
      case 'string':
        return '';
      case 'number':
      case 'integer':
        return 0;
      case 'boolean':
        return false;
      case 'array': {
        const itemSkeleton = schema.items ? this.skeletonValue(schema.items) : null;
        return itemSkeleton === null || itemSkeleton === undefined ? [] : [itemSkeleton];
      }
      case 'object':
        return this.buildSkeletonFromSchema(schema);
      case 'null':
        return null;
      default:
        if (schema.properties) {
          return this.buildSkeletonFromSchema(schema);
        }
        return null;
    }
  }

  async sendToolRequest() {
    const tool = this.getSelectedTool();
    if (!tool) {
      return;
    }
    if (!this.currentServer || !this.currentServer.isConnected) {
      this.showToast('Not connected to an MCP server', 'error');
      return;
    }

    let parameters;
    const raw = this.ttRequestJson.value.trim();
    if (!raw) {
      parameters = {};
    } else {
      try {
        parameters = JSON.parse(raw);
      } catch (e) {
        this.ttRequestStatus.textContent = 'Invalid JSON: ' + e.message;
        this.ttRequestStatus.className = 'tt-status tt-status-error';
        return;
      }
    }

    this.ttSendBtn.disabled = true;
    this.ttRequestStatus.textContent = 'Sending request…';
    this.ttRequestStatus.className = 'tt-status tt-status-progress';
    this.ttResponseContent.innerHTML = '';
    this.ttResponseContent.textContent = '⏳ Waiting for response…';

    // Ensure debounced header edits reach the server before the direct call.
    await this.flushPendingHeaders();

    const startedAt = performance.now();
    try {
      const response = await apiFetch(`${API_BASE}/api/mcp/call-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: this.currentServer.name,
          toolName: tool.name,
          parameters,
        }),
      });
      const data = await response.json();
      const elapsedMs = Math.round(performance.now() - startedAt);

      if (!response.ok || !data.success) {
        const errMsg = data.error || `HTTP ${response.status}`;
        this.ttRequestStatus.textContent = `Error in ${elapsedMs} ms`;
        this.ttRequestStatus.className = 'tt-status tt-status-error';
        this.renderToolResponse({ error: errMsg }, true);
        return;
      }

      this.ttRequestStatus.textContent = `Success in ${data.durationMs ?? elapsedMs} ms`;
      this.ttRequestStatus.className = 'tt-status tt-status-success';
      this.renderToolResponse(data.result, false, data.uiResource);
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      this.ttRequestStatus.textContent = `Error in ${elapsedMs} ms`;
      this.ttRequestStatus.className = 'tt-status tt-status-error';
      this.renderToolResponse({ error: error.message || String(error) }, true);
    } finally {
      this.ttSendBtn.disabled = false;
    }
  }

  renderToolResponse(result, isError, uiResource) {
    this.ttLastResult = result;
    this.ttResponseContent.classList.toggle('tt-response-error', !!isError);
    if (isError) {
      this.ttResponseTextMode = false;
    }
    this.renderToolResponseBody();
    this.renderToolResponseWidget(uiResource);
  }

  /**
   * Mount or tear down the split-view widget panel next to the raw JSON
   * response. Only renders when MCP Apps mode is ON and the server actually
   * returned a UI resource (either embedded or via `_meta.ui.resourceUri`).
   */
  renderToolResponseWidget(uiResource) {
    let panel = document.getElementById('ttUiWidgetPanel');
    if (this._ttUiBridge) {
      try {
        this._ttUiBridge.destroy();
      } catch {
        /* ignore */
      }
      this._ttUiBridge = null;
    }
    if (!this.appMode || !uiResource) {
      if (panel) {
        panel.remove();
      }
      this.ttLayout?.classList.remove('tt-has-ui');
      return;
    }

    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ttUiWidgetPanel';
      panel.className = 'tt-panel tt-ui-panel';
      panel.setAttribute('data-testid', 'at-tt-ui-panel');
      panel.innerHTML = `
        <header class="tt-panel-header">
          <h3>UI Widget</h3>
          <span class="tt-ui-badge">MCP Apps</span>
        </header>
        <div class="tt-ui-body"></div>
      `;
      this.ttLayout.appendChild(panel);
    }

    const body = panel.querySelector('.tt-ui-body');
    body.innerHTML = '';

    const tool = this.getSelectedTool();
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const appCall = {
      callId: `tt-${Date.now()}`,
      toolName: tool?.name || 'unknown',
      arguments: this._safeParseJson(this.ttRequestJson?.value) || {},
      result: this.ttLastResult,
      uiResource,
    };
    const bridge = new AppWidgetBridge(
      appCall,
      { theme: { name: theme }, hostVersion: this.sdkVersion || '0.0.0' },
      {
        onJsonRpcMessage: (direction, msg) => this._logUiMessage(direction, msg, appCall),
        onViewCallTool: (params, ac) => this._proxyViewCallTool(params, ac),
        onLog: (params, ac) => this._logUiMessage('log', { method: 'notifications/message', params }, ac),
      },
    );
    bridge.mount(body);
    this._ttUiBridge = bridge;
    this.ttLayout.classList.add('tt-has-ui');
  }

  _safeParseJson(s) {
    if (!s) {
      return null;
    }
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  renderToolResponseBody() {
    const result = this.ttLastResult;
    this.ttResponseContent.classList.toggle('tt-response-text-mode', this.ttResponseTextMode);
    if (this.ttResponseTextView) {
      this.ttResponseTextView.classList.toggle('active', this.ttResponseTextMode);
    }
    if (result === null || result === undefined) {
      this.ttResponseContent.textContent = '';
      return;
    }
    if (this.ttResponseTextMode) {
      const firstText = this.extractFirstText(result);
      if (firstText === null) {
        this.ttResponseContent.textContent = '(no text field found in content[])';
        return;
      }
      const parsed = this.tryParseJson(firstText);
      if (parsed.ok) {
        this.renderPrettyJson(parsed.value);
      } else {
        this.ttResponseContent.textContent = firstText;
      }
      return;
    }
    this.renderPrettyJson(result);
  }

  renderPrettyJson(value) {
    if (window.prettyPrintJson && typeof window.prettyPrintJson.toHtml === 'function') {
      try {
        this.ttResponseContent.innerHTML = window.prettyPrintJson.toHtml(value, { indent: 2 });
        return;
      } catch {
        /* fall back to plain text */
      }
    }
    try {
      this.ttResponseContent.textContent = JSON.stringify(value, null, 2);
    } catch {
      this.ttResponseContent.textContent = String(value);
    }
  }

  extractFirstText(result) {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const content = Array.isArray(result.content) ? result.content : null;
    if (!content) {
      return null;
    }
    const first = content.find((c) => c && typeof c.text === 'string');
    return first ? first.text : null;
  }

  tryParseJson(text) {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return { ok: true, value: JSON.parse(trimmed) };
      } catch {
        /* fall through */
      }
    }
    return { ok: false };
  }

  toggleResponseTextMode() {
    if (this.ttLastResult === null || this.ttLastResult === undefined) {
      return;
    }
    this.ttResponseTextMode = !this.ttResponseTextMode;
    this.renderToolResponseBody();
  }

  clearToolResponse() {
    this.ttLastResult = null;
    this.ttResponseTextMode = false;
    this.ttResponseContent.classList.remove('tt-response-error', 'tt-response-text-mode');
    if (this.ttResponseTextView) {
      this.ttResponseTextView.classList.remove('active');
    }
    this.ttResponseContent.innerHTML =
      '<span class="tt-placeholder">No response yet. Connect to a server, select a tool, and send a request.</span>';
    this.renderToolResponseWidget(null);
    this.ttRequestStatus.textContent = '';
    this.ttRequestStatus.className = 'tt-status';
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const authManager = new AuthManager();
  const canProceed = await authManager.init();
  if (canProceed) {
    window.mcpAgentTester = new McpAgentTester();
  }
  // If !canProceed, AuthManager shows login overlay and creates McpAgentTester after successful login
});
