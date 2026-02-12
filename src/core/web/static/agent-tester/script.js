const API_BASE = '/agent-tester';
const trim = (s) => String(s || '').trim();

class McpAgentTester {
  constructor () {
    this.currentSessionId = null;
    this.currentServer = null;
    this.currentSystemPrompt = '';
    this.usedHeaders = [];
    this.pendingConnectionData = null;
    this._headersUpdateTimer = null;
    this.defaultMcpUrl = null;
    this.authEnabled = false;
    this.configHttpHeaders = {};
    this._authRefreshInterval = null;
    this._currentAuthType = null;
    this.messageFormats = {};
    this.messageTexts = {};
    this.defaultDisplayFormat = localStorage.getItem('agentTesterDefaultFormat') || 'HTML';

    this.mcpConfig = {
      url: null,
      transport: 'http',
      headers: {},
      name: null,
    };

    this.initializeElements();
    this.initTheme();
    this.bindEvents();
    this.loadInitialData();

    this.setupAutoResize();

    console.log('MCP Agent Tester initialized');
  }

  sanitizeHtml (html) {
    const allowedTags = [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'code', 'pre',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'a', 'span', 'div',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ];

    const allowedAttributes = {
      'a': ['href', 'title', 'target'],
      'th': ['colspan', 'rowspan'],
      'td': ['colspan', 'rowspan'],
      'code': ['class'],
      'pre': ['class'],
      'span': ['class'],
      'div': ['class'],
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

      if (!allowedTags.includes(tagName)) {
        const textNode = document.createTextNode(node.textContent || '');
        return textNode;
      }

      const cleanedElement = document.createElement(tagName);

      const allowedAttrs = allowedAttributes[tagName] || [];
      allowedAttrs.forEach(attr => {
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

      Array.from(node.childNodes).forEach(child => {
        const cleanedChild = cleanNode(child);
        if (cleanedChild) {
          cleanedElement.appendChild(cleanedChild);
        }
      });

      return cleanedElement;
    };

    const cleanedNodes = Array.from(tempDiv.childNodes).map(cleanNode).filter(node => node !== null);

    const finalDiv = document.createElement('div');
    cleanedNodes.forEach(node => finalDiv.appendChild(node));

    return finalDiv.innerHTML.trim();
  }

  createFormatToggle (messageId) {
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'format-toggle-container';

    const select = document.createElement('select');
    select.className = 'format-toggle';
    select.dataset.messageId = messageId;

    const options = ['MD', 'HTML'];
    const currentFormat = this.messageFormats[messageId] || 'MD';

    options.forEach(opt => {
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

  onFormatChange (messageId, format) {
    this.messageFormats[messageId] = format;
    const originalText = this.messageTexts[messageId];
    const messageText = document.querySelector(`.message-text[data-message-id="${messageId}"]`);
    if (messageText && originalText) {
      this.renderMessageContent(messageText, originalText, format);
    }
  }

  handleDefaultFormatChange () {
    const value = this.defaultFormatSelect.value;
    this.defaultDisplayFormat = value;
    localStorage.setItem('agentTesterDefaultFormat', value);
    if (value === 'HTML') {
      this.showToast('Tip: add "Format your response in HTML" to Custom Prompt for best results', 'info');
    }
  }

  renderMessageContent (element, text, format) {
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

  initializeElements () {
    this.sidebar = document.getElementById('sidebar');
    this.sidebarToggle = document.getElementById('sidebarToggle');
    this.sidebarToggleMobile = document.getElementById('sidebarToggleMobile');

    this.mcpConnectionForm = document.getElementById('mcpConnectionForm');
    this.serverUrlInput = document.getElementById('serverUrl');
    this.transportSelect = document.getElementById('transport');

    this.serverUrlDropdown = document.getElementById('serverUrlDropdown');
    this.serverUrlDropdownList = document.getElementById('serverUrlDropdownList');
    this.savedUrlsList = document.getElementById('savedUrlsList');

    this.currentServer = null;

    this.headersSection = document.getElementById('headersSection');
    this.dynamicHeaders = document.getElementById('dynamicHeaders');

    this.modelSelect = document.getElementById('modelSelect');

    this.customModelSettings = document.getElementById('customModelSettings');
    this.customBaseUrl = document.getElementById('customBaseUrl');
    this.customApiKey = document.getElementById('customApiKey');
    this.customModelName = document.getElementById('customModelName');
    this.modelTemperature = document.getElementById('modelTemperature');
    this.modelMaxTokens = document.getElementById('modelMaxTokens');
    this.modelMaxTurns = document.getElementById('modelMaxTurns');
    this.toolResultLimitChars = document.getElementById('toolResultLimitChars');

    this.systemPromptTextarea = document.getElementById('systemPrompt');
    this.customPromptTextarea = document.getElementById('customPrompt');

    this.connectedServersContainer = document.getElementById('connectedServers');

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
  }

  bindEvents () {
    if (this.sidebarToggle) {
      this.sidebarToggle.addEventListener('click', () => this.toggleSidebar());
    }
    if (this.sidebarToggleMobile) {
      this.sidebarToggleMobile.addEventListener('click', () => this.toggleSidebar());
    }

    if (this.themeToggle) {
      this.themeToggle.addEventListener('click', () => this.toggleTheme());
    }

    if (this.defaultFormatSelect) {
      this.defaultFormatSelect.value = this.defaultDisplayFormat;
      this.defaultFormatSelect.addEventListener('change', () => this.handleDefaultFormatChange());
    }

    this.mcpConnectionForm.addEventListener('submit', (e) => this.handleMcpConnection(e));

    this.serverUrlInput.addEventListener('input', () => this.handleServerUrlChange());
    this.transportSelect.addEventListener('change', () => this.saveFormValuesToStorage());

    this.serverUrlDropdown.addEventListener('click', (e) => this.toggleUrlDropdown(e));
    document.addEventListener('click', (e) => this.handleClickOutside(e));

    this.modelSelect.addEventListener('change', () => {
      this.handleModelSelectChange();
      this.saveFormValuesToStorage();
    });
    this.systemPromptTextarea.addEventListener('input', () => this.saveFormValuesToStorage());
    this.customPromptTextarea.addEventListener('input', () => this.saveFormValuesToStorage());

    this.customBaseUrl.addEventListener('input', () => this.saveFormValuesToStorage());
    this.customApiKey.addEventListener('input', () => this.saveFormValuesToStorage());
    this.customModelName.addEventListener('input', () => this.saveFormValuesToStorage());
    this.modelTemperature.addEventListener('input', () => this.saveFormValuesToStorage());
    this.modelMaxTokens.addEventListener('input', () => this.saveFormValuesToStorage());
    this.modelMaxTurns.addEventListener('input', () => this.saveFormValuesToStorage());
    this.toolResultLimitChars.addEventListener('input', () => this.saveFormValuesToStorage());

    document.querySelectorAll('.btn-enlarge').forEach(btn => {
      btn.addEventListener('click', () => this.openPromptModal(btn.dataset.target));
    });
    document.getElementById('promptModalClose').addEventListener('click', () => this.closePromptModal());
    document.getElementById('promptModalSave').addEventListener('click', () => this.savePromptModal());
    document.getElementById('promptModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {this.closePromptModal();}
    });

    this.messageInput.addEventListener('input', () => this.handleInputChange());
    this.messageInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.sendButton.addEventListener('click', () => this.sendMessage());
    this.clearChatBtn.addEventListener('click', () => this.clearChat());

    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 &&
        !this.sidebar.contains(e.target) &&
        !this.sidebarToggleMobile.contains(e.target) &&
        this.sidebar.classList.contains('open')) {
        this.toggleSidebar();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        this.sidebar.classList.remove('open');
      }
    });
  }

  initTheme () {
    const saved = localStorage.getItem('mcpAgentTheme');
    let theme = saved;
    if (!theme) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    this.applyTheme(theme);
  }

  toggleTheme () {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
    localStorage.setItem('mcpAgentTheme', next);
  }

  applyTheme (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (this.themeToggle) {
      const icon = this.themeToggle.querySelector('.material-icons-round');
      if (icon) {
        icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
      }
    }
  }

  openPromptModal (targetId) {
    this._promptModalTarget = document.getElementById(targetId);
    const modal = document.getElementById('promptModal');
    const textarea = document.getElementById('promptModalTextarea');
    const title = document.getElementById('promptModalTitle');
    title.textContent = targetId === 'systemPrompt' ? 'Agent Prompt' : 'Custom Prompt';
    textarea.value = this._promptModalTarget.value;
    modal.style.display = 'flex';
    textarea.focus();
  }

  closePromptModal () {
    document.getElementById('promptModal').style.display = 'none';
    this._promptModalTarget = null;
  }

  savePromptModal () {
    if (this._promptModalTarget) {
      this._promptModalTarget.value = document.getElementById('promptModalTextarea').value;
      this.saveFormValuesToStorage();
    }
    this.closePromptModal();
  }

  setupAutoResize () {
    this.messageInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
  }

  toggleSidebar () {
    this.sidebar.classList.toggle('open');
  }

  async loadInitialData () {
    try {
      this.loadFormValuesFromStorage();
      this.loadFormValuesFromURL();
      this.handleServerUrlChange();
      this.renderSavedUrls();
      await this.loadDefaultConfig();
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

  async autoConnect () {
    const serverUrl = this.serverUrlInput.value.trim();
    if (!serverUrl) {return;}

    const transport = this.transportSelect.value;
    const serverName = this.generateServerName(serverUrl);

    const connectionData = {
      name: serverName,
      url: serverUrl,
      transport: transport,
      headers: this.getHeadersFromForm(),
    };

    this.showLoading('Auto-connecting to MCP server...');

    try {
      const response = await fetch(`${API_BASE}/api/mcp/connect`, {
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
        };

        if (result.config && result.config.agentPrompt) {
          this.systemPromptTextarea.value = result.config.agentPrompt;
          this.currentSystemPrompt = result.config.agentPrompt;
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

  async loadDefaultConfig () {
    try {
      const response = await fetch(`${API_BASE}/api/config`);
      const config = await response.json();
      this.defaultMcpUrl = config.defaultMcpUrl || null;
      this.authEnabled = !!config.authEnabled;
      this.configHttpHeaders = config.httpHeaders || {};
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

  async handleMcpConnection (event) {
    event.preventDefault();

    const serverUrl = this.serverUrlInput.value.trim();
    const transport = this.transportSelect.value;

    const serverName = this.generateServerName(serverUrl);

    const connectionData = {
      name: serverName,
      url: serverUrl,
      transport: transport,
      headers: this.getHeadersFromForm(),
    };

    this.showLoading('Connecting to MCP server...');

    try {
      const response = await fetch(`${API_BASE}/api/mcp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        };

        if (result.config && result.config.agentPrompt) {
          this.systemPromptTextarea.value = result.config.agentPrompt;
          this.currentSystemPrompt = result.config.agentPrompt;
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

  generateServerName (url) {
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

  async checkRequiredHeaders () {
    const url = this.serverUrlInput.value.trim();

    if (!url) {
      this.showToast('Please enter a server URL first', 'warning');
      return;
    }

    this.showLoading('Checking used headers...');

    try {
      const response = await fetch(`${API_BASE}/api/mcp/used-headers?url=${encodeURIComponent(url)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const headers = await response.json();
        this.usedHeaders = Array.isArray(headers) ? headers : [];
        this.renderHeaderInputs();
        await this.autoFillAuthHeader();

        if (this.usedHeaders.length > 0) {
          const reqCount = this.usedHeaders.filter(h => !h.isOptional).length;
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

  renderHeaderInputs () {
    this.dynamicHeaders.innerHTML = '';
    const savedHeaders = this.loadHeaderValuesFromStorage();

    this.usedHeaders.forEach(header => {
      const headerGroup = document.createElement('div');
      headerGroup.className = 'header-row';

      const savedValue = savedHeaders[header.name] || this.configHttpHeaders[header.name] || '';
      const isRequired = !header.isOptional;
      const hasDesc = header.description && header.description.trim();
      const nameClass = hasDesc ? 'header-name has-tooltip' : 'header-name';
      const tooltipAttr = hasDesc ? ` data-tooltip="${header.description.replace(/"/g, '&quot;')}"` : '';
      const inputClass = isRequired ? 'header-value used-header' : 'header-value';

      headerGroup.innerHTML = `
                <span class="${nameClass}"${tooltipAttr}>${header.name}</span>
                <input
                    type="text"
                    class="${inputClass}"
                    id="header_${header.name}"
                    placeholder="${header.name}"
                    data-header-name="${header.name}"
                    data-required="${isRequired}"
                    value="${savedValue.replace(/"/g, '&quot;')}"
                >
            `;

      this.dynamicHeaders.appendChild(headerGroup);

      const nameEl = headerGroup.querySelector('.header-name');
      if (nameEl && hasDesc) {
        nameEl.style.cursor = 'pointer';
        nameEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleHeaderTooltip(e, header.description);
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

  toggleHeaderTooltip (e, text) {
    const tip = document.getElementById('headerTooltip');
    if (tip.classList.contains('visible') && tip._sourceEl === e.target) {
      this.hideHeaderTooltip();
      return;
    }
    tip._sourceEl = e.target;
    tip.textContent = text;
    const rect = e.target.getBoundingClientRect();
    tip.style.left = rect.left + 'px';
    tip.style.top = (rect.top - 4) + 'px';
    tip.style.transform = 'translateY(-100%)';
    tip.classList.add('visible');

    const dismissOnClick = (ev) => {
      if (ev.target !== e.target && !tip.contains(ev.target)) {
        this.hideHeaderTooltip();
        document.removeEventListener('click', dismissOnClick);
      }
    };
    setTimeout(() => document.addEventListener('click', dismissOnClick), 0);
  }

  hideHeaderTooltip () {
    const tip = document.getElementById('headerTooltip');
    tip.classList.remove('visible');
    tip._sourceEl = null;
  }

  updateHeaderBorder (inputEl) {
    if (inputEl.dataset.required === 'true') {
      if (inputEl.value.trim()) {
        inputEl.classList.remove('empty-required');
      } else {
        inputEl.classList.add('empty-required');
      }
    }
  }

  getHeaderStorageKey () {
    const url = this.serverUrlInput.value.trim();
    return `mcpHeaderValues_${url}`;
  }

  saveHeaderValuesToStorage () {
    const headers = this.getHeadersFromForm();
    const key = this.getHeaderStorageKey();
    try {
      localStorage.setItem(key, JSON.stringify(headers));
    } catch (error) {
      console.error('Error saving header values to storage:', error);
    }
  }

  loadHeaderValuesFromStorage () {
    const key = this.getHeaderStorageKey();
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error loading header values from storage:', error);
      return {};
    }
  }

  scheduleHeadersUpdate () {
    this.mcpConfig.headers = this.getHeadersFromForm();

    if (this._headersUpdateTimer) {
      clearTimeout(this._headersUpdateTimer);
    }
    this._headersUpdateTimer = setTimeout(() => {
      this.applyHeadersUpdate().catch(err => console.warn('Apply headers failed:', err));
    }, 600);
  }

  async applyHeadersUpdate () {
    if (!this.currentServer || !this.currentServer.name) {
      return;
    }
    const headers = this.getHeadersFromForm();
    try {
      const resp = await fetch(`${API_BASE}/api/mcp/headers`, {
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

  getHeadersFromForm () {
    const headers = {};

    if (this.usedHeaders.length === 0) {
      return headers;
    }

    this.usedHeaders.forEach(header => {
      const input = document.getElementById(`header_${header.name}`);
      if (input && input.value.trim()) {
        headers[header.name] = input.value.trim();
      }
    });

    return headers;
  }

  isOwnService () {
    return this.defaultMcpUrl && this.serverUrlInput.value.trim() === this.defaultMcpUrl;
  }

  async autoFillAuthHeader () {
    if (!this.authEnabled) {return;}

    const hasAuthHeader = this.usedHeaders.some(h => h.name === 'Authorization');
    if (!hasAuthHeader) {return;}

    // Skip if localStorage already has a saved value for this URL's Authorization header
    const savedHeaders = this.loadHeaderValuesFromStorage();
    if (savedHeaders['Authorization']) {return;}

    try {
      const response = await fetch(`${API_BASE}/api/auth-token`);
      if (!response.ok) {return;}

      const data = await response.json();
      this._currentAuthType = data.authType;

      const input = document.getElementById('header_Authorization');
      if (input) {
        input.value = data.token;
        this.updateHeaderBorder(input);
        this.saveHeaderValuesToStorage();
        this.scheduleHeadersUpdate();
      }

      // Start JWT refresh interval if connecting to own service
      if (data.authType === 'jwtToken' && this.isOwnService()) {
        this.startAuthRefresh();
      }
    } catch (e) {
      console.warn('Failed to auto-fill auth header:', e);
    }
  }

  startAuthRefresh () {
    this.stopAuthRefresh();
    this._authRefreshInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth-token/refresh`, { method: 'POST' });
        if (!response.ok) {return;}

        const data = await response.json();
        const input = document.getElementById('header_Authorization');
        if (input) {
          input.value = data.token;
          this.saveHeaderValuesToStorage();
          this.scheduleHeadersUpdate();
        }
      } catch (e) {
        console.warn('Failed to refresh auth token:', e);
      }
    }, 4 * 60 * 1000); // every 4 minutes
  }

  stopAuthRefresh () {
    if (this._authRefreshInterval) {
      clearInterval(this._authRefreshInterval);
      this._authRefreshInterval = null;
    }
  }

  resetConnectionForm () {
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
    };
    window.history.replaceState({}, document.title, window.location.pathname);
    localStorage.removeItem('mcpAgentFormValues');
  }

  async loadCurrentServer () {
    try {
      const response = await fetch(`${API_BASE}/api/mcp/servers`);
      const servers = await response.json();

      if (servers && servers.length > 0) {
        this.currentServer = servers[0];
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

  renderServerInfo () {
    if (!this.currentServer) {
      this.connectedServersContainer.innerHTML = '';
      return;
    }

    const server = this.currentServer;
    const toolCount = server.tools ? server.tools.length : 0;

    if (server.isConnected) {
      this.connectedServersContainer.innerHTML = `
        <div class="server-status-row">
          <span class="server-status connected">${toolCount} tools <span class="material-icons-round">check_circle</span> connected</span>
          <button type="button" class="btn btn-danger disconnect-btn"><span class="material-icons-round">link_off</span>Disconnect</button>
        </div>`;
    } else {
      this.connectedServersContainer.innerHTML = `
        <div class="server-status-row">
          <span class="server-status disconnected"><span class="material-icons-round">cancel</span>Disconnected</span>
          <button type="button" class="btn btn-secondary reconnect-btn"><span class="material-icons-round">refresh</span>Reconnect</button>
        </div>`;
    }

    this.connectedServersContainer.querySelector('.disconnect-btn')?.addEventListener('click', () => {
      this.disconnectServer();
    });

    this.connectedServersContainer.querySelector('.reconnect-btn')?.addEventListener('click', () => {
      this.handleReconnect();
    });
  }

  async disconnectServer () {
    if (!this.currentServer) {
      return;
    }

    this.stopAuthRefresh();

    try {
      const response = await fetch(`${API_BASE}/api/mcp/disconnect/${this.currentServer.name}`, {
        method: 'POST',
      });

      if (response.ok) {
        this.showToast(`Disconnected from ${this.currentServer.name}`, 'success');
        this.currentServer = null;
        this.mcpConfig = {
          url: null,
          transport: 'http',
          headers: {},
          name: null,
        };
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

  async handleReconnect () {
    if (!this.currentServer) {
      return;
    }

    const connectionData = {
      name: this.currentServer.name,
      url: this.currentServer.url,
      transport: this.currentServer.transport || 'http',
      headers: this.currentServer.headers || {},
    };

    this.showLoading('Reconnecting to MCP server...');

    try {
      const response = await fetch(`${API_BASE}/api/mcp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

  updateConnectionStatus () {
    if (!this.connectionStatus) {return;}
    if (this.currentServer && this.currentServer.isConnected) {
      this.connectionStatus.textContent = `Connected to ${this.currentServer.name}`;
      this.connectionStatus.classList.add('connected');
    } else {
      this.connectionStatus.textContent = 'Not Connected';
      this.connectionStatus.classList.remove('connected');
    }
  }

  handleInputChange () {
    const length = this.messageInput.value.length;
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

  handleKeyDown (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  async sendMessage () {
    const message = this.messageInput.value.trim();
    if (!message) {return;}

    if (!this.validateCustomModelSettings()) {
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
        mcpConfig: this.mcpConfig.url ? {
          url: this.mcpConfig.url,
          transport: this.mcpConfig.transport,
          headers: this.mcpConfig.headers,
          name: this.mcpConfig.name,
        } : undefined,
        modelConfig: modelConfig,
      };

      const response = await fetch(`${API_BASE}/api/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      this.currentSessionId = result.sessionId;

      this.addMessage(result.message, 'assistant', result.metadata);

    } catch (error) {
      console.error('Send message error:', error);
      this.addMessage(`Error: ${error.message}`, 'assistant', { error: true });
      this.showToast('Failed to send message: ' + error.message, 'error');
    } finally {
      this.hideTypingIndicator();
    }
  }

  addMessage (text, sender, metadata = {}) {
    const messageId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.dataset.messageId = messageId;

    if (metadata.error) {
      messageDiv.classList.add('error');
    }

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = sender === 'user' ? '<span class="material-icons-round">person</span>' : '<span class="material-icons-round">smart_toy</span>';

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

  showTypingIndicator () {
    this.typingIndicator.classList.add('visible');
  }

  hideTypingIndicator () {
    this.typingIndicator.classList.remove('visible');
  }

  clearChat () {
    const welcomeMessage = this.chatMessages.querySelector('.message.welcome');
    this.chatMessages.innerHTML = '';
    if (welcomeMessage) {
      this.chatMessages.appendChild(welcomeMessage);
    }

    this.currentSessionId = null;

    this.showToast('Chat cleared', 'success');
  }

  scrollToBottom () {
    setTimeout(() => {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }, 100);
  }

  showLoading (message = 'Loading...') {
    this.loadingOverlay.querySelector('span').textContent = message;
    this.loadingOverlay.style.display = 'flex';
  }

  hideLoading () {
    this.loadingOverlay.style.display = 'none';
  }

  showToast (message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = {
      'success': 'check_circle',
      'error': 'error',
      'warning': 'warning',
      'info': 'info',
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

  handleModelSelectChange () {
    const isOther = this.modelSelect.value === 'other';
    this.customModelSettings.style.display = isOther ? 'block' : 'none';
  }

  validateCustomModelSettings () {
    if (this.modelSelect.value !== 'other') {
      return true;
    }

    const baseURL = trim(this.customBaseUrl.value);
    const apiKey = trim(this.customApiKey.value);
    const modelName = trim(this.customModelName.value);
    const temperature = this.modelTemperature.value;
    const maxTokens = this.modelMaxTokens.value;

    const missingFields = [];
    if (!baseURL) {missingFields.push('Base URL');}
    if (!apiKey) {missingFields.push('API Key');}
    if (!modelName) {missingFields.push('Model Name');}
    if (!temperature) {missingFields.push('Temperature');}
    if (!maxTokens) {missingFields.push('Max Tokens');}

    if (missingFields.length > 0) {
      this.showToast(`Missing required fields: ${missingFields.join(', ')}`, 'error');
      return false;
    }

    return true;
  }

  getModelConfig () {
    const isOther = this.modelSelect.value === 'other';
    const t = parseFloat(this.modelTemperature.value);
    const temperature = Number.isNaN(t) ? 0.1 : t;
    const maxTokens = parseInt(this.modelMaxTokens.value, 10) || 2048;
    const maxTurns = parseInt(this.modelMaxTurns.value, 10) || 10;
    const toolResultLimitChars = parseInt(this.toolResultLimitChars.value, 10) || 20000;

    if (isOther) {
      return {
        baseURL: trim(this.customBaseUrl.value),
        apiKey: trim(this.customApiKey.value),
        model: trim(this.customModelName.value),
        temperature: temperature,
        maxTokens: maxTokens,
        maxTurns: maxTurns,
        toolResultLimitChars: toolResultLimitChars,
      };
    }

    return {
      model: this.modelSelect.value,
      temperature: temperature,
      maxTokens: maxTokens,
      maxTurns: maxTurns,
      toolResultLimitChars: toolResultLimitChars,
    };
  }

  handleServerUrlChange () {
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

  saveFormValuesToStorage () {
    const formData = {
      serverUrl: this.serverUrlInput.value,
      transport: this.transportSelect.value,
      model: this.modelSelect.value,
      agentPrompt: trim(this.systemPromptTextarea.value),
      customPrompt: trim(this.customPromptTextarea.value),
      customBaseUrl: trim(this.customBaseUrl.value),
      customApiKey: trim(this.customApiKey.value),
      customModelName: trim(this.customModelName.value),
      modelTemperature: this.modelTemperature.value,
      modelMaxTokens: this.modelMaxTokens.value,
      modelMaxTurns: this.modelMaxTurns.value,
      toolResultLimitChars: this.toolResultLimitChars.value,
    };
    localStorage.setItem('mcpAgentFormValues', JSON.stringify(formData));
  }

  loadFormValuesFromURL () {
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

  loadFormValuesFromStorage () {
    try {
      const stored = localStorage.getItem('mcpAgentFormValues');
      if (stored) {
        const formData = JSON.parse(stored);
        if (formData.serverUrl) {this.serverUrlInput.value = formData.serverUrl;}
        if (formData.transport) {this.transportSelect.value = formData.transport;}
        if (formData.model) {this.modelSelect.value = formData.model;}
        if (formData.agentPrompt) {this.systemPromptTextarea.value = trim(formData.agentPrompt);}
        if (formData.customPrompt) {this.customPromptTextarea.value = trim(formData.customPrompt);}
        if (formData.customBaseUrl) {this.customBaseUrl.value = formData.customBaseUrl;}
        if (formData.customApiKey) {this.customApiKey.value = formData.customApiKey;}
        if (formData.customModelName) {this.customModelName.value = formData.customModelName;}
        if (formData.modelTemperature) {this.modelTemperature.value = formData.modelTemperature;}
        if (formData.modelMaxTokens) {this.modelMaxTokens.value = formData.modelMaxTokens;}
        if (formData.modelMaxTurns) {this.modelMaxTurns.value = formData.modelMaxTurns;}
        if (formData.toolResultLimitChars) {this.toolResultLimitChars.value = formData.toolResultLimitChars;}
        this.handleModelSelectChange();
      }
    } catch (error) {
      console.error('Error loading form values from storage:', error);
    }
  }

  getSavedUrls () {
    try {
      const saved = localStorage.getItem('mcpSavedUrls');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Error loading saved URLs:', error);
      return [];
    }
  }

  saveSavedUrls (urls) {
    try {
      localStorage.setItem('mcpSavedUrls', JSON.stringify(urls));
    } catch (error) {
      console.error('Error saving URLs:', error);
    }
  }

  addUrlToSaved (url) {
    if (!url || url.trim() === '') {
      return;
    }

    url = url.trim();
    let savedUrls = this.getSavedUrls();

    savedUrls = savedUrls.filter(savedUrl => savedUrl !== url);

    savedUrls.unshift(url);

    savedUrls = savedUrls.slice(0, 10);

    this.saveSavedUrls(savedUrls);
    this.renderSavedUrls();
  }

  removeUrlFromSaved (url) {
    let savedUrls = this.getSavedUrls();
    savedUrls = savedUrls.filter(savedUrl => savedUrl !== url);
    this.saveSavedUrls(savedUrls);
    this.renderSavedUrls();
  }

  renderSavedUrls () {
    const savedUrls = this.getSavedUrls();
    this.savedUrlsList.innerHTML = '';

    if (savedUrls.length === 0) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'dropdown-item disabled';
      emptyItem.innerHTML = '<span style="color: rgba(255,255,255,0.5);">No saved URLs</span>';
      this.savedUrlsList.appendChild(emptyItem);
      return;
    }

    savedUrls.forEach(url => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';

      item.innerHTML = `
        <div class="url-item">
          <span class="url-text" title="${url}">${url}</span>
          <button class="delete-btn" title="Delete URL">
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

  selectUrl (url) {
    this.serverUrlInput.value = url;
    this.handleServerUrlChange();
    this.closeUrlDropdown();
    this.autoConnect();
  }

  toggleUrlDropdown (e) {
    e.preventDefault();
    e.stopPropagation();

    const isVisible = this.serverUrlDropdownList.style.display !== 'none';

    if (isVisible) {
      this.closeUrlDropdown();
    } else {
      this.openUrlDropdown();
    }
  }

  openUrlDropdown () {
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

  closeUrlDropdown () {
    this.serverUrlDropdownList.style.display = 'none';
    this.serverUrlDropdown.classList.remove('active');
  }

  addCurrentUrlToSaved () {
    const currentUrl = this.serverUrlInput.value.trim();
    if (currentUrl) {
      this.addUrlToSaved(currentUrl);
      this.closeUrlDropdown();
      this.showToast('URL added to saved', 'success');
    }
  }

  handleClickOutside (e) {
    const container = e.target.closest('.custom-select-container');
    if (!container) {
      this.closeUrlDropdown();
    }
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.mcpAgentTester = new McpAgentTester();
});
