/**
 * About page renderer with template substitution
 */

import { appConfig } from '../../bootstrap/init-config.js';
import type { AppConfig } from '../../_types_/config.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { isMainDBConnected } from '../../db/pg-db.js';
import { getFaviconSvg } from '../favicon-svg.js';
import { getPromptsList } from '../../mcp/prompts.js';
import { getResourcesList } from '../../mcp/resources.js';
import { McpServerData } from '../../types.js';

function getProjectData(): McpServerData {
  return (global as any).__MCP_PROJECT_DATA__;
}

let staffSvg: string = getFaviconSvg();

export class AboutPageRenderer {
  private htmlTemplate: string;
  private cssContent: string;
  private appConfig: AppConfig;
  private toolsCount: number;
  private resourcesCount: number;
  private promptsCount: number;
  private tools: Tool[];
  private resources: any[];
  private prompts: any[];
  private startTime: Date;

  constructor (appConfig: AppConfig) {
    this.appConfig = appConfig;
    this.resourcesCount = 0;
    this.promptsCount = 0;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    this.startTime = new Date();

    // Initialize templates
    this.htmlTemplate = this.getHtmlTemplate();
    this.cssContent = this.getCssTemplate();

    const { tools } = getProjectData();
    this.tools = tools;
    this.toolsCount = tools.length;

    this.resources = getResourcesList().resources;
    this.resourcesCount = this.resources.length;

    this.prompts = getPromptsList().prompts;
    this.promptsCount = this.prompts.length;
    this.startTime = new Date();
  }

  private getHtmlTemplate (): string {
    return `<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8' />
  <meta name='viewport' content='width=device-width, initial-scale=1' />
  <title>{{SERVICE_TITLE}} MCP Server</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,{{SERVICE_ICON_ENCODED}}">
</head>
<body>
  <div class="simple-container">
    <!-- Header -->
    <header class="simple-header">
      <div class="header-row">
        <div class="header-title">
          <div class="service-icon">{{SERVICE_ICON}}</div>
          <h1>{{SERVICE_TITLE}} MCP Server</h1>
        </div>
        <div class="status {{STATUS_CLASS}}">{{STATUS_TEXT}}</div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="simple-main">
      <!-- Basic Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">Service:</span>
          <span class="value">{{SERVICE_DESCRIPTION}}</span>
        </div>
        <div class="info-row">
          <span class="label">Version:</span>
          <span class="value">{{SERVICE_VERSION}}</span>
        </div>
        <div class="info-row">
          <span class="label">Tools:</span>
          <span class="value clickable" onclick="openModal('tools')">{{TOOLS_COUNT}} available</span>
        </div>
        <div class="info-row">
          <span class="label">Resources:</span>
          <span class="value clickable" onclick="openModal('resources')">{{RESOURCES_COUNT}} available</span>
        </div>
        <div class="info-row">
          <span class="label">Prompts:</span>
          <span class="value clickable" onclick="openModal('prompts')">{{PROMPTS_COUNT}} available</span>
        </div>
        <div class="info-row">
          <span class="label">Uptime:</span>
          <span class="value">{{UPTIME}}</span>
        </div>
      </section>

      <!-- Database Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">Database:</span>
          <div>
            <span class="value">{{DB_HOST}}:{{DB_PORT}}/{{DB_DATABASE}} • </span>
            <span class="value {{DB_STATUS_CLASS}}">{{DB_STATUS}}</span>    
          </div>
        </div>
      </section>

      <!-- Transport Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">HTTP Transport:</span>
          <span class="value"><code>GET /sse</code> • <code>POST /mcp</code></span>
        </div>
      </section>
      ${(() => {
        const { httpComponents } = getProjectData();
        const swagger = httpComponents?.swagger;
        return swagger
          ? `<!-- Swagger -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">API Reference:</span>
          <span class="value">
                  <a href="/docs" target="_blank" rel="noopener">Swagger</a>
          </span>
        </div>
      </section>`
          : '';
      })()}
      <!-- Health Check -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">Health Check:</span>
          <span class="value clickable" onclick="openHealthCheckModal()">Check Server Health</span>
        </div>
      </section>

      </main>

    <!-- Modal Overlays -->
    <!-- Tools Modal -->
    <div id="tools-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Available Tools ({{TOOLS_COUNT}})</h3>
          <button class="modal-close" onclick="closeModal('tools')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="table-container">
            <table class="details-table" id="tools-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <!-- Content will be dynamically loaded -->
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Resources Modal -->
    <div id="resources-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Available Resources ({{RESOURCES_COUNT}})</h3>
          <button class="modal-close" onclick="closeModal('resources')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="table-container">
            <table class="details-table" id="resources-table">
              <thead>
                <tr>
                  <th>URI</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>MIME Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <!-- Content will be dynamically loaded -->
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Prompts Modal -->
    <div id="prompts-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Available Prompts ({{PROMPTS_COUNT}})</h3>
          <button class="modal-close" onclick="closeModal('prompts')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="table-container">
            <table class="details-table" id="prompts-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <!-- Content will be dynamically loaded -->
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Health Check Modal -->
    <div id="health-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Server Health Check</h3>
          <button class="modal-close" onclick="closeModal('health')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="loading-cell" id="health-loading">
            <div class="loading-spinner"></div>
            Checking server health...
          </div>
          <pre class="json-content" id="health-result" style="display: none;"></pre>
          <div class="error-message" id="health-error" style="display: none;"></div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="simple-footer">
      <p>
        Server: {{SERVER_NAME}} v{{SERVICE_VERSION}} • Started: {{START_TIME}}<br>
        <a href="{{REPO}}" target="_blank" rel="noopener">
          GitHub Repository
        </a>
      </p>
    </footer>
  </div>

  <script>
    // Store data globally
    let toolsData = [];
    let resourcesData = [];
    let promptsData = [];

    // Initialize data when page loads
    document.addEventListener('DOMContentLoaded', function() {
      try {
        toolsData = {{TOOLS_JSON}};
        resourcesData = {{RESOURCES_JSON}};
        promptsData = {{PROMPTS_JSON}};
      } catch (error) {
        console.error('Error parsing data:', error);
        toolsData = [];
        resourcesData = [];
        promptsData = [];
      }
    });

    function openModal(sectionName) {
      const modal = document.getElementById(sectionName + '-modal');
      const tableBody = document.getElementById(sectionName + '-table').querySelector('tbody');

      // Show loading state
      tableBody.innerHTML = '<tr><td colspan="100%" class="loading-cell"><div class="loading-spinner"></div> Loading...</td></tr>';
      modal.style.display = 'flex';

      // Load data with small delay to show loading animation
      setTimeout(function() {
        loadTableData(sectionName);
      }, 300);
    }

    function closeModal(sectionName) {
      const modal = document.getElementById(sectionName + '-modal');
      modal.style.display = 'none';
    }

    function loadTableData(sectionName) {
      const tableBody = document.getElementById(sectionName + '-table').querySelector('tbody');
      let data, html;

      switch(sectionName) {
        case 'tools':
          data = toolsData;
          html = generateToolsTableRows(data);
          break;
        case 'resources':
          data = resourcesData;
          html = generateResourcesTableRows(data);
          break;
        case 'prompts':
          data = promptsData;
          html = generatePromptsTableRows(data);
          break;
      }

      tableBody.innerHTML = html;
    }

    function generateToolsTableRows(tools) {
      if (!tools || tools.length === 0) {
        return '<tr><td colspan="3" class="loading-cell">No tools available</td></tr>';
      }
      return tools.map((tool, index) =>
        '<tr>' +
          '<td><code>' + tool.name + '</code></td>' +
          '<td>' + (tool.annotations?.title || tool.description) + '</td>' +
          '<td>' +
            '<a class="detail-link" id="tools-toggle-' + index + '" onclick="toggleDetails(\\\'tools\\\', ' + index + ')">details</a>' +
          '</td>' +
        '</tr>' +
        '<tr id="tools-detail-' + index + '" class="detail-row" style="display: none;">' +
          '<td colspan="3">' +
            '<div class="detail-content">' +
              '<div class="loading-spinner" style="display: none;"></div>' +
              '<pre class="json-content" style="display: none;"></pre>' +
            '</div>' +
          '</td>' +
        '</tr>'
      ).join('');
    }

    function generateResourcesTableRows(resources) {
      if (!resources || resources.length === 0) {
        return '<tr><td colspan="5" class="loading-cell">No resources available</td></tr>';
      }
      return resources.map((resource, index) =>
        '<tr>' +
          '<td><code>' + resource.uri + '</code></td>' +
          '<td>' + resource.name + '</td>' +
          '<td>' + resource.description + '</td>' +
          '<td><code>' + resource.mimeType + '</code></td>' +
          '<td>' +
            '<a class="detail-link" id="resources-toggle-details-' + index + '" onclick="toggleResourceDetails(\\\'resources\\\', ' + index + ', \\\'details\\\')">details</a>' +
            ' / ' +
            '<a class="detail-link" id="resources-toggle-resource-' + index + '" onclick="toggleResourceDetails(\\\'resources\\\', ' + index + ', \\\'resource\\\')">resource</a>' +
          '</td>' +
        '</tr>' +
        '<tr id="resources-detail-' + index + '" class="detail-row" style="display: none;">' +
          '<td colspan="5">' +
            '<div class="detail-content">' +
              '<div class="loading-spinner"></div>' +
              '<pre class="json-content" style="display: none;"></pre>' +
              '<div class="resource-content" style="display: none;"></div>' +
            '</div>' +
          '</td>' +
        '</tr>'
      ).join('');
    }

    function generatePromptsTableRows(prompts) {
      if (!prompts || prompts.length === 0) {
        return '<tr><td colspan="2" class="loading-cell">No prompts available</td></tr>';
      }
      return prompts.map((prompt, index) =>
        '<tr>' +
          '<td><code>' + prompt.name + '</code></td>' +
          '<td>' +
            '<a class="detail-link" id="prompts-toggle-details-' + index + '" onclick="togglePromptDetails(\\\'prompts\\\', ' + index + ', \\\'details\\\')">details</a>' +
            ' / ' +
            '<a class="detail-link" id="prompts-toggle-prompt-' + index + '" onclick="togglePromptDetails(\\\'prompts\\\', ' + index + ', \\\'prompt\\\')">prompt</a>' +
          '</td>' +
        '</tr>' +
        '<tr id="prompts-detail-' + index + '" class="detail-row" style="display: none;">' +
          '<td colspan="2">' +
            '<div class="detail-content">' +
              '<div class="loading-spinner"></div>' +
              '<pre class="json-content" style="display: none;"></pre>' +
              '<div class="prompt-content" style="display: none;"></div>' +
            '</div>' +
          '</td>' +
        '</tr>'
      ).join('');
    }

    function toggleDetails(sectionName, index) {
      const detailRow = document.getElementById(sectionName + '-detail-' + index);
      const toggleLink = document.getElementById(sectionName + '-toggle-' + index);
      const loadingSpinner = detailRow.querySelector('.loading-spinner');
      const jsonContent = detailRow.querySelector('.json-content');

      if (detailRow.style.display === 'none') {
        // Show the detail row with loading state
        detailRow.style.display = 'table-row';
        toggleLink.textContent = 'hide';
        loadingSpinner.style.display = 'block';
        jsonContent.style.display = 'none';

        // Simulate loading delay and show content
        setTimeout(() => {
          let data;
          let textContent;
          switch(sectionName) {
            case 'tools':
              data = {
                name: toolsData[index].name,
                description: toolsData[index].description,
                inputSchema: toolsData[index].inputSchema,
                annotations: toolsData[index].annotations
              };
              textContent = JSON.stringify(data, null, 2);
              break;
            case 'resources':
              data = resourcesData[index].content || resourcesData[index];
              textContent = JSON.stringify(data, null, 2);
              // Try to parse JSON from contents[0]?.text and add explanation
              const text = data.contents?.[0]?.text;
              if (text) {
                try {
                  const parsedJson = JSON.parse(text);
                  data.contents[0].text = parsedJson;
                  textContent = 'Text field - deserialized data:\\n\\n' + JSON.stringify(data, null, 2);
                } catch (e) {
                  // If parsing fails, keep original data
                }
              }
              break;
            case 'prompts':
              data = promptsData[index];
              textContent = JSON.stringify(data, null, 2)
              break;
          }

          loadingSpinner.style.display = 'none';
          jsonContent.style.display = 'block';
          jsonContent.textContent = textContent;
        }, 500);
      } else {
        // Hide the detail row
        detailRow.style.display = 'none';
        toggleLink.textContent = 'details';
      }
    }

    // Handle prompt details and prompt content display
    async function togglePromptDetails(sectionName, index, displayType) {
      const detailRow = document.getElementById(sectionName + '-detail-' + index);
      const toggleLinkDetails = document.getElementById(sectionName + '-toggle-details-' + index);
      const toggleLinkPrompt = document.getElementById(sectionName + '-toggle-prompt-' + index);
      const loadingSpinner = detailRow.querySelector('.loading-spinner');
      const jsonContent = detailRow.querySelector('.json-content');
      const promptContent = detailRow.querySelector('.prompt-content');

      const isCurrentlyHidden = detailRow.style.display === 'none';
      const currentToggleLink = displayType === 'details' ? toggleLinkDetails : toggleLinkPrompt;
      const otherToggleLink = displayType === 'details' ? toggleLinkPrompt : toggleLinkDetails;

      if (isCurrentlyHidden || currentToggleLink.textContent === displayType) {
        // Show the detail row with loading state
        detailRow.style.display = 'table-row';
        currentToggleLink.textContent = 'hide';
        otherToggleLink.textContent = displayType === 'details' ? 'prompt' : 'details';
        loadingSpinner.style.display = 'block';
        jsonContent.style.display = 'none';
        promptContent.style.display = 'none';

        if (displayType === 'details') {
          // Show JSON details
          setTimeout(() => {
            const data = promptsData[index];
            const textContent = JSON.stringify(data, null, 2);
            loadingSpinner.style.display = 'none';
            jsonContent.style.display = 'block';
            jsonContent.textContent = textContent;
          }, 300);
        } else {
          // Fetch and show prompt content
          try {
            const promptName = promptsData[index].name;
            const response = await fetch('/mcp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'prompts/get',
                params: { name: promptName }
              })
            });

            if (!response.ok) {
              throw new Error('HTTP ' + response.status);
            }

            const result = await response.json();
            const messages = result.result?.messages || [];
            let promptText = '';

            messages.forEach((msg, i) => {
              if (i > 0) promptText += '\\n\\n---\\n\\n';
              promptText += 'Role: ' + msg.role + '\\n\\n';
              if (typeof msg.content === 'string') {
                promptText += msg.content;
              } else if (msg.content?.text) {
                promptText += msg.content.text;
              } else {
                promptText += JSON.stringify(msg.content, null, 2);
              }
            });

            loadingSpinner.style.display = 'none';
            promptContent.style.display = 'block';
            promptContent.innerHTML = '<pre class="json-content">' + promptText + '</pre>';
          } catch (error) {
            loadingSpinner.style.display = 'none';
            promptContent.style.display = 'block';
            promptContent.innerHTML = '<div class="error-message">Failed to load prompt: ' + error.message + '</div>';
          }
        }
      } else {
        // Hide the detail row
        detailRow.style.display = 'none';
        toggleLinkDetails.textContent = 'details';
        toggleLinkPrompt.textContent = 'prompt';
      }
    }

    // Handle resource details and resource content display
    async function toggleResourceDetails(sectionName, index, displayType) {
      const detailRow = document.getElementById(sectionName + '-detail-' + index);
      const toggleLinkDetails = document.getElementById(sectionName + '-toggle-details-' + index);
      const toggleLinkResource = document.getElementById(sectionName + '-toggle-resource-' + index);
      const loadingSpinner = detailRow.querySelector('.loading-spinner');
      const jsonContent = detailRow.querySelector('.json-content');
      const resourceContent = detailRow.querySelector('.resource-content');

      const isCurrentlyHidden = detailRow.style.display === 'none';
      const currentToggleLink = displayType === 'details' ? toggleLinkDetails : toggleLinkResource;
      const otherToggleLink = displayType === 'details' ? toggleLinkResource : toggleLinkDetails;

      if (isCurrentlyHidden || currentToggleLink.textContent === displayType) {
        // Show the detail row with loading state
        detailRow.style.display = 'table-row';
        currentToggleLink.textContent = 'hide';
        otherToggleLink.textContent = displayType === 'details' ? 'resource' : 'details';
        loadingSpinner.style.display = 'block';
        jsonContent.style.display = 'none';
        resourceContent.style.display = 'none';

        if (displayType === 'details') {
          // Show JSON details
          setTimeout(() => {
            const data = resourcesData[index];
            const textContent = JSON.stringify(data, null, 2);
            loadingSpinner.style.display = 'none';
            jsonContent.style.display = 'block';
            jsonContent.textContent = textContent;
          }, 300);
        } else {
          // Fetch and show resource content
          try {
            const resourceUri = resourcesData[index].uri;
            const response = await fetch('/mcp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'resources/read',
                params: { uri: resourceUri }
              })
            });

            if (!response.ok) {
              throw new Error('HTTP ' + response.status);
            }

            const result = await response.json();
            const contents = result.result?.contents || [];
            let resourceText = '';

            contents.forEach((content, i) => {
              if (i > 0) resourceText += '\\n\\n---\\n\\n';
              resourceText += 'URI: ' + content.uri + '\\n';
              resourceText += 'MIME Type: ' + content.mimeType + '\\n\\n';
              if (content.text) {
                resourceText += content.text;
              } else if (content.blob) {
                resourceText += '[Binary content: ' + content.blob.length + ' bytes]';
              } else {
                resourceText += JSON.stringify(content, null, 2);
              }
            });

            loadingSpinner.style.display = 'none';
            resourceContent.style.display = 'block';
            resourceContent.innerHTML = '<pre class="json-content">' + resourceText + '</pre>';
          } catch (error) {
            loadingSpinner.style.display = 'none';
            resourceContent.style.display = 'block';
            resourceContent.innerHTML = '<div class="error-message">Failed to load resource: ' + error.message + '</div>';
          }
        }
      } else {
        // Hide the detail row
        detailRow.style.display = 'none';
        toggleLinkDetails.textContent = 'details';
        toggleLinkResource.textContent = 'resource';
      }
    }

    // Health Check Modal
    async function openHealthCheckModal() {
      const modal = document.getElementById('health-modal');
      const loading = document.getElementById('health-loading');
      const result = document.getElementById('health-result');
      const error = document.getElementById('health-error');

      // Show modal with loading state
      modal.style.display = 'flex';
      loading.style.display = 'block';
      result.style.display = 'none';
      error.style.display = 'none';

      try {
        const response = await fetch('/health');

        if (!response.ok) {
          throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }

        const data = await response.json();

        // Hide loading and show result
        loading.style.display = 'none';
        result.style.display = 'block';
        result.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        // Hide loading and show error
        loading.style.display = 'none';
        error.style.display = 'block';
        error.textContent = 'Error: ' + (err.message || 'Failed to fetch health check data');
      }
    }

    // Close modal when clicking outside
    document.addEventListener('click', function(event) {
      if (event.target.classList.contains('modal-overlay')) {
        const modalId = event.target.id;
        const sectionName = modalId.replace('-modal', '');
        closeModal(sectionName);
      }
    });
  </script>
</body>
</html>`;
  }

  private getCssTemplate (): string {
    return `
:root {
  /* Primary Colors */
  --color-primary-600: ${appConfig.uiColor.primary || '#0052cc'};
  --color-primary-500: #0065ff;

  /* Secondary Colors */
  --color-success-600: #006644;

  /* Danger Colors */
  --color-danger-600: #bf2600;
  --color-danger-400: #ff5630;

  /* Neutral Colors */
  --color-neutral-1000: #172b4d;
  --color-neutral-900: #253858;
  --color-neutral-700: #42526e;
  --color-neutral-600: #505f79;
  --color-neutral-200: #c1c7d0;
  --color-neutral-100: #dfe1e6;
  --color-neutral-90: #ebecf0;
  --color-neutral-20: #fafbfc;
  --color-neutral-10: #ffffff;

  /* Spacing - 8px grid */
  --space-025: 2px;
  --space-050: 4px;
  --space-075: 6px;
  --space-100: 8px;
  --space-150: 12px;
  --space-200: 16px;
  --space-250: 20px;
  --space-300: 24px;
  --space-400: 32px;
  --space-500: 40px;
  --space-600: 48px;
  --space-800: 64px;
  --space-1000: 80px;

  /* Typography */
  --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  --font-family-mono: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;

  /* Font sizes */
  --font-size-050: 11px;
  --font-size-075: 12px;
  --font-size-100: 14px;
  --font-size-200: 16px;
  --font-size-300: 20px;
  --font-size-400: 24px;
  --font-size-500: 29px;
  --font-size-600: 35px;

  /* Border radius */
  --border-radius-050: 2px;
  --border-radius-100: 3px;
  --border-radius-200: 6px;
  --border-radius-300: 8px;
  --border-radius-400: 12px;

  /* Shadows */
  --shadow-raised: 0 1px 1px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31);
  --shadow-overlay: 0 4px 8px -2px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31);
  --shadow-card: 0 1px 3px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31);
}

/* Reset and base styles */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
}

body {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-100);
  line-height: 1.5;
  color: var(--color-neutral-900);
  background: white;
  margin: 0;
  padding: 20px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

/* Simple Layout */
.simple-container {
  width: 100%;
  max-width: 670px;
  background: white;
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--border-radius-200);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-top: 40px;
}

/* Simple Header */
.simple-header {
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--color-neutral-200);
  background: var(--color-neutral-20);
  border-radius: var(--border-radius-200) var(--border-radius-200) 0 0;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 16px;
}

.service-icon {
  width: 40px;
  height: 40px;
  display: flex;
  margin-right: 10px;
  align-items: center;
  justify-content: center;
}

.service-icon svg {
  width: 100%;
  height: 100%;
}

.simple-header h1 {
  font-size: 30px;
  font-weight: 700;
  margin: 0;
  color: var(--color-primary-600);
}

.status {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.status.online {
  background: var(--color-success-100);
  color: var(--color-success-600);
}

.status.offline {
  background: var(--color-danger-100);
  color: var(--color-danger-600);
}

/* Simple Main Content */
.simple-main {
  padding: 20px 32px;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(9, 30, 66, 0.5);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-content {
  background: white;
  border-radius: var(--border-radius-300);
  box-shadow: var(--shadow-overlay);
  max-width: 90vw;
  max-height: 90vh;
  width: 900px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: var(--color-neutral-20);
  border-bottom: 1px solid var(--color-neutral-200);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--font-size-300);
  font-weight: 600;
  color: var(--color-primary-600);
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  font-weight: 300;
  color: var(--color-neutral-600);
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius-100);
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--color-neutral-100);
  color: var(--color-neutral-900);
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.table-container {
  overflow-x: auto;
  border-radius: var(--border-radius-100);
  border: 1px solid var(--color-neutral-200);
}

.details-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  font-size: var(--font-size-075);
}

.details-table th {
  background: var(--color-neutral-100);
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: var(--color-neutral-900);
  border-bottom: 2px solid var(--color-neutral-200);
  white-space: nowrap;
}

.details-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-neutral-100);
  vertical-align: top;
}

.details-table tr:hover {
  background: var(--color-neutral-20);
}

.details-table tr:last-child td {
  border-bottom: none;
}

/* Detail row styles */
.detail-row {
  background: var(--color-neutral-20);
}

.detail-row td {
  padding: 0;
}

.detail-content {
  padding: 16px;
}

/* Loading spinner */
.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-neutral-200);
  border-top: 2px solid var(--color-primary-500);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 12px auto;
}

.loading-cell {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-neutral-600);
  font-size: var(--font-size-100);
}

.loading-cell .loading-spinner {
  margin-bottom: 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* JSON content styles */
.json-content {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-050);
  line-height: 1.4;
  color: var(--color-neutral-1000);
  white-space: pre-wrap;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  background: var(--color-neutral-90);
  padding: 16px;
  border-radius: var(--border-radius-100);
  border: 1px solid var(--color-neutral-200);
}

/* Prompt content styles */
.prompt-content {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-075);
  line-height: 1.5;
  color: var(--color-neutral-1000);
  max-height: 400px;
  overflow-y: auto;
}

.prompt-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* Resource content styles */
.resource-content {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-075);
  line-height: 1.5;
  color: var(--color-neutral-1000);
  max-height: 400px;
  overflow-y: auto;
}

.resource-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* Error message styles */
.error-message {
  padding: 16px;
  background: #ffebe9;
  color: var(--color-danger-600);
  border: 1px solid var(--color-danger-400);
  border-radius: var(--border-radius-100);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-075);
  text-align: center;
}

.clickable {
  color: var(--color-primary-500) !important;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s ease;
}

.clickable:hover {
  color: var(--color-primary-600);
  text-decoration: underline;
}

.detail-link {
  color: var(--color-primary-500);
  text-decoration: none;
  font-size: var(--font-size-075);
  font-weight: 500;
  cursor: pointer;
}

.detail-link:hover {
  color: var(--color-primary-600);
  text-decoration: underline;
}


/* Info Section */
.info-section {
  margin-bottom: 0;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-neutral-100);
}

.info-row:last-child {
  border-bottom: none;
}

.label {
  font-weight: 500;
  color: var(--color-neutral-700);
  min-width: 100px;
}

.value {
  text-align: right;
  color: var(--color-neutral-1000);
  font-family: var(--font-family-mono);
  font-size: 14px;
}

.value.link {
  color: var(--color-primary-500);
  text-decoration: none;
}

.value.link:hover {
  color: var(--color-primary-600);
  text-decoration: underline;
}

.value.connected {
  color: var(--color-success-600);
}

.value.disconnected {
  color: var(--color-danger-600);
}


/* Simple Footer */
.simple-footer {
  padding: 16px 32px;
  background: var(--color-neutral-20);
  border-top: 1px solid var(--color-neutral-200);
  border-radius: 0 0 var(--border-radius-200) var(--border-radius-200);
}

.simple-footer p {
  margin: 0;
  font-size: 12px;
  color: var(--color-neutral-600);
  text-align: center;
}

.simple-footer a {
  color: var(--color-primary-500);
  text-decoration: none;
}

.simple-footer a:hover {
  color: var(--color-primary-600);
  text-decoration: underline;
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .simple-container {
    margin-top: 20px;
    max-width: 600px;
  }

  .simple-header {
    padding: 20px 24px 16px;
  }

  .header-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .header-title {
    gap: 12px;
  }

  .service-icon {
    width: 32px;
    height: 32px;
  }

  .simple-main {
    padding: 16px 24px;
  }

  .simple-footer {
    padding: 12px 24px;
  }

  .info-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px 0;
  }

  .label {
    min-width: auto;
  }

  .value {
    text-align: left;
  }
}`;
  }

  private async getDbStatus (): Promise<{ status: string; statusClass: string }> {
    try {
      const isConnected = await isMainDBConnected();
      if (isConnected) {
        return {
          status: 'Connected',
          statusClass: 'connected',
        };
      } else {
        return {
          status: 'Disconnected',
          statusClass: 'disconnected',
        };
      }
    } catch {
      return {
        status: 'Error',
        statusClass: 'disconnected',
      };
    }
  }

  private getServiceUrl (): { url: string; label: string } {
    const port = this.appConfig.webServer.port || 9018;
    return {
      url: `<a href="http://localhost:${port}" class="value link">http://localhost:${port}</a>`,
      label: 'Service URL',
    };
  }

  private getUptime (): string {
    const uptimeMs = Date.now() - this.startTime.getTime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private escapeJsonForScript (data: any): string {
    // JSON.stringify already handles proper escaping for JavaScript
    // We just need to ensure it's safe for HTML context
    return JSON.stringify(data);
  }

  private encodeSvgForDataUri (svg: string): string {
    // Encode SVG for use in data URI
    return encodeURIComponent(svg)
      .replace(/'/g, '%27')
      .replace(/"/g, '%22');
  }

  private async substitutePlaceholders (template: string): Promise<string> {

    const serviceUrls = this.getServiceUrl();
    const dbStatus = await this.getDbStatus();
    const dbInfo = appConfig.db.postgres!.dbs.main!;
    const iconEncoded = this.encodeSvgForDataUri(staffSvg);

    return template
      .replace(/\{\{SERVICE_TITLE}}/g, appConfig.productName.replace(/MCP/i, '').replace(/\s{2,}/g, ' ').trim())
      .replace(/\{\{SERVICE_ICON}}/g, staffSvg)
      .replace(/\{\{SERVICE_ICON_ENCODED}}/g, iconEncoded)
      .replace(/\{\{SERVICE_DESCRIPTION}}/g, appConfig.description)
      .replace(/\{\{SERVICE_VERSION}}/g, appConfig.version)
      .replace(/\{\{SERVICE_URL}}/g, serviceUrls.url)
      .replace(/\{\{SERVICE_URL_LABEL}}/g, serviceUrls.label)
      .replace(/\{\{TOOLS_COUNT}}/g, this.toolsCount.toString())
      .replace(/\{\{RESOURCES_COUNT}}/g, this.resourcesCount.toString())
      .replace(/\{\{PROMPTS_COUNT}}/g, this.promptsCount.toString())
      .replace(/\{\{TOOLS_JSON}}/g, this.escapeJsonForScript(this.tools))
      .replace(/\{\{RESOURCES_JSON}}/g, this.escapeJsonForScript(this.resources))
      .replace(/\{\{PROMPTS_JSON}}/g, this.escapeJsonForScript(this.prompts))
      .replace(/\{\{DB_STATUS}}/g, dbStatus.status)
      .replace(/\{\{DB_STATUS_CLASS}}/g, dbStatus.statusClass)
      .replace(/\{\{STATUS_TEXT}}/g, 'online')
      .replace(/\{\{STATUS_CLASS}}/g, 'online')
      .replace(/\{\{UPTIME}}/g, this.getUptime())
      .replace(/\{\{SERVER_NAME}}/g, appConfig.name)
      .replace(/\{\{START_TIME}}/g, this.startTime.toISOString())
      .replace(/\{\{DB_LABEL}}/g, dbInfo.label!)
      .replace(/\{\{DB_HOST}}/g, dbInfo.host)
      .replace(/\{\{DB_PORT}}/g, String(dbInfo.port))
      .replace(/\{\{DB_DATABASE}}/g, dbInfo.database)
      .replace(/\{\{REPO}}/g, appConfig.repo);
  }

  public async renderFullPage (): Promise<string> {
    const html = await this.substitutePlaceholders(this.htmlTemplate);
    return html.replace('</head>', `  <style>${this.cssContent}</style>\n</head>`);
  }
}

/**
 * Get server health status (backward compatibility)
 */
export async function getHealthStatus (): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: {
    database: boolean;
    uptime: number;
    timestamp: string;
  };
}> {
  let isDbConnected = false;

  try {
    isDbConnected = await isMainDBConnected();
  } catch {
    isDbConnected = false;
  }

  return {
    status: isDbConnected ? 'healthy' : 'unhealthy',
    details: {
      database: isDbConnected,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  };
}
