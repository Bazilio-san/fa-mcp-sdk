import { getResourcesList } from '../../mcp/resources.js';
import { getPromptsList } from '../../mcp/prompts.js';
import { getMainDBConnectionStatus } from '../../db/pg-db.js';
import { getFaviconSvg } from '../favicon-svg.js';
import { appConfig, getProjectData } from '../../bootstrap/init-config.js';
import { getCss } from './css.js';

const startTime = new Date();

const getUptime = (): string => {
  const uptimeMs = Date.now() - startTime.getTime();
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
};

const encodeSvgForDataUri = (svg: string): string => {
  // Encode SVG for use in data URI
  return encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
};

export const renderAboutPage = async (): Promise<string> => {
  const { version, repo } = appConfig;
  const serviceTitle = appConfig.productName.replace(/MCP/i, '').replace(/\s{2,}/g, ' ').trim();
  const staffSvg = getFaviconSvg();
  const iconEncoded = encodeSvgForDataUri(staffSvg);
  const { resources } = getResourcesList();
  const { prompts } = getPromptsList();
  const { tools, httpComponents } = (global as any).__MCP_PROJECT_DATA__;

  let swaggerInfo = '';
  if (httpComponents?.swagger) {
    swaggerInfo = `<!-- Swagger -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">API Reference:</span>
          <span class="value">
                  <a href="/docs" target="_blank" rel="noopener" class="clickable">Swagger</a>
          </span>
        </div>
      </section>`;
  }

  let dbInfo = '';
  if (appConfig.isMainDBUsed) {
    const dbStatus = await getMainDBConnectionStatus();
    const { host, port, database } = appConfig.db.postgres!.dbs.main!;
    dbInfo = `<!-- Database Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">Database:</span>
          <div>
            <span class="value">${host}:${port}/${database} • </span>
            <span class="value ${dbStatus}">${dbStatus}</span>    
          </div>
        </div>
      </section>`;
  }
  const { getConsulUIAddress = (_s: string) => '', assets } = getProjectData();
  const footerData: string[] = [];
  if (repo) {
    footerData.push(`<a href="${repo}" target="_blank" rel="noopener">GitHub Repository</a>`);
  }
  if (assets?.maintainerHtml) {
    footerData.push(assets?.maintainerHtml);
  }
  let consulInfo = '';
  if (!appConfig.consul.service.noRegOnStart) {
    const { id } = appConfig.consul.service;
    if (id) {
      consulInfo = `<!-- Consul Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">Consul id:</span>
          <span class="value"><a href="${getConsulUIAddress(id)}" target="_blank" rel="noopener" class="clickable">${id}</a></span>
        </div>
      </section>`;
    }
  }
  const docType = '<!DOCTYPE html>';
  // @formatter:off
  return docType + `
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${serviceTitle} MCP Server</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${iconEncoded}">
  <style>${getCss(appConfig.uiColor.primary)}</style>
</head>
<body>
  <div class="simple-container">
    <!-- Header -->
    <header class="simple-header">
      <div class="header-row">
        <div class="header-title">
          <div class="service-icon">${staffSvg}</div>
          <h1><span class="MCPServer">MCP Server</span> ${serviceTitle}</h1>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="simple-main">
      <!-- Basic Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">Service:</span>
          <span class="value">${appConfig.description}</span>
        </div>
        <div class="info-row">
          <span class="label">Version:</span>
          <span class="value">${version}</span>
        </div>
        <div class="info-row">
          <span class="label">Tools:</span>
          <span class="value clickable" onclick="openModal('tools')">${tools.length} available</span>
        </div>
        <div class="info-row">
          <span class="label">Resources:</span>
          <span class="value clickable" onclick="openModal('resources')">${resources.length} available</span>
        </div>
        <div class="info-row">
          <span class="label">Prompts:</span>
          <span class="value clickable" onclick="openModal('prompts')">${prompts.length} available</span>
        </div>
        <div class="info-row">
          <span class="label">Uptime:</span>
          <span class="value">${getUptime()}</span>
        </div>
      </section>
      ${dbInfo}
      <!-- Transport Info -->
      <section class="info-section">
        <div class="info-row">
          <span class="label">HTTP Transport:</span>
          <span class="value"><code>GET /sse</code> • <code>POST /mcp</code></span>
        </div>
      </section>

      ${swaggerInfo}
      
      ${consulInfo}
      
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
          <h3>Available Tools (${tools.length})</h3>
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
          <h3>Available Resources (${resources.length})</h3>
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
          <h3>Available Prompts (${prompts.length})</h3>
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
        ${footerData.join(' • ')}
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
        toolsData = ${JSON.stringify(tools)};
        resourcesData = ${JSON.stringify(resources)};
        promptsData = ${JSON.stringify(prompts)};
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
          addCopyButton(jsonContent);
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
            addCopyButton(jsonContent);
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
            addCopyButton(promptContent.querySelector('.json-content'));
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
            addCopyButton(jsonContent);
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
            addCopyButton(resourceContent.querySelector('.json-content'));
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
        addCopyButton(result);
      } catch (err) {
        // Hide loading and show error
        loading.style.display = 'none';
        error.style.display = 'block';
        error.textContent = 'Error: ' + (err.message || 'Failed to fetch health check data');
      }
    }

    // Copy to clipboard functionality
    function addCopyButton(contentElement) {
      if (!contentElement || contentElement.hasAttribute('data-copy-added')) {
        return;
      }

      contentElement.setAttribute('data-copy-added', 'true');

      const copyButton = document.createElement('button');
      copyButton.className = 'copy-button';
      copyButton.innerHTML = '📋';
      copyButton.title = 'Copy to clipboard';
      copyButton.setAttribute('aria-label', 'Copy to clipboard');

      const notification = document.createElement('div');
      notification.className = 'copy-notification';
      notification.textContent = 'Copied';

      contentElement.appendChild(copyButton);
      contentElement.appendChild(notification);

      copyButton.addEventListener('click', async function() {
        let textToCopy = contentElement.textContent || contentElement.innerText;
        textToCopy = textToCopy.replace(/📋Copied/, '')
        try {
          await navigator.clipboard.writeText(textToCopy);

          // Show notification
          notification.classList.add('show');

          // Hide notification after 1 second
          setTimeout(() => {
            notification.classList.remove('show');
          }, 1000);

        } catch (err) {
          // Fallback for browsers that don't support clipboard API
          const textArea = document.createElement('textarea');
          textArea.value = textToCopy;
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();

          try {
            document.execCommand('copy');

            // Show notification
            notification.classList.add('show');

            // Hide notification after 1 second
            setTimeout(() => {
              notification.classList.remove('show');
            }, 1000);
          } catch (fallbackErr) {
            console.error('Failed to copy text:', fallbackErr);
          }

          document.body.removeChild(textArea);
        }
      });
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
};

