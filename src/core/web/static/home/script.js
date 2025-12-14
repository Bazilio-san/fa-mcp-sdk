// Store data globally
let toolsData = [];
let resourcesData = [];
let promptsData = [];
let pageData = {};

// Set primary color CSS variable
function setPrimaryColor (color) {
  if (color) {
    document.documentElement.style.setProperty('--primary-color', color);
  }
}

// Set favicon dynamically
function setFavicon (svgContent) {
  if (!svgContent) {return;}

  const encoded = encodeURIComponent(svgContent)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');

  const link = document.querySelector('link[rel="icon"]') || document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encoded;

  if (!document.querySelector('link[rel="icon"]')) {
    document.head.appendChild(link);
  }
}

// Set header icon dynamically
function setHeaderIcon (svgContent) {
  const iconContainer = document.getElementById('serviceIcon');
  if (iconContainer && svgContent) {
    iconContainer.innerHTML = svgContent;
  }
}

// Render page info
function renderPageInfo (data) {
  // Service title
  const titleEl = document.getElementById('serviceTitle');
  if (titleEl) {
    titleEl.innerHTML = '<span class="MCPServer">MCP Server</span> ' + data.serviceTitle;
  }

  // Document title
  document.title = data.serviceTitle + ' MCP Server';

  // Description
  const descEl = document.getElementById('serviceDescription');
  if (descEl) {descEl.textContent = data.description;}

  // Version
  const versionEl = document.getElementById('serviceVersion');
  if (versionEl) {versionEl.textContent = data.version;}

  // Uptime
  const uptimeEl = document.getElementById('serviceUptime');
  if (uptimeEl) {uptimeEl.textContent = data.uptime;}

  // Tools count
  const toolsEl = document.getElementById('toolsCount');
  if (toolsEl) {toolsEl.textContent = data.toolsCount + ' available';}

  // Resources count
  const resourcesEl = document.getElementById('resourcesCount');
  if (resourcesEl) {resourcesEl.textContent = data.resourcesCount + ' available';}

  // Prompts count
  const promptsEl = document.getElementById('promptsCount');
  if (promptsEl) {promptsEl.textContent = data.promptsCount + ' available';}

  // Database info
  const dbSection = document.getElementById('dbSection');
  if (dbSection) {
    if (data.db) {
      dbSection.style.display = 'block';
      const dbValue = document.getElementById('dbValue');
      const dbStatus = document.getElementById('dbStatus');
      if (dbValue) {dbValue.textContent = data.db.connection + ' • ';}
      if (dbStatus) {
        dbStatus.textContent = data.db.status;
        dbStatus.className = 'value ' + data.db.status;
      }
    } else {
      dbSection.style.display = 'none';
    }
  }

  // Swagger info
  const swaggerSection = document.getElementById('swaggerSection');
  if (swaggerSection) {
    swaggerSection.style.display = data.swagger ? 'block' : 'none';
  }

  // Consul info
  const consulSection = document.getElementById('consulSection');
  if (consulSection) {
    if (data.consul && data.consul.id) {
      consulSection.style.display = 'block';
      const consulLink = document.getElementById('consulLink');
      if (consulLink) {
        consulLink.href = data.consul.url;
        consulLink.textContent = data.consul.id;
      }
    } else {
      consulSection.style.display = 'none';
    }
  }

  // Footer
  const footerContent = document.getElementById('footerContent');
  if (footerContent && data.footer) {
    footerContent.innerHTML = data.footer;
  }
}

// Load page data from API
async function loadPageData () {
  try {
    const response = await fetch('/api/home-info');
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const data = await response.json();
    pageData = data;

    // Set theme color
    setPrimaryColor(data.primaryColor);

    // Set favicon and header icon (logo)
    setFavicon(data.logoSvg);
    setHeaderIcon(data.logoSvg);

    // Store MCP data
    toolsData = data.tools || [];
    resourcesData = data.resources || [];
    promptsData = data.prompts || [];

    // Render page info
    renderPageInfo(data);

  } catch (error) {
    console.error('Error loading page data:', error);
  }
}

function openModal (sectionName) {
  const modal = document.getElementById(sectionName + '-modal');
  const tableBody = document.getElementById(sectionName + '-table').querySelector('tbody');

  // Show loading state
  tableBody.innerHTML = '<tr><td colspan="100%" class="loading-cell"><div class="loading-spinner"></div> Loading...</td></tr>';
  modal.style.display = 'flex';

  // Load data with small delay to show loading animation
  setTimeout(function () {
    loadTableData(sectionName);
  }, 300);
}

function closeModal (sectionName) {
  const modal = document.getElementById(sectionName + '-modal');
  modal.style.display = 'none';
}

function loadTableData (sectionName) {
  const tableBody = document.getElementById(sectionName + '-table').querySelector('tbody');
  let data, html;

  switch (sectionName) {
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

function generateToolsTableRows (tools) {
  if (!tools || tools.length === 0) {
    return '<tr><td colspan="3" class="loading-cell">No tools available</td></tr>';
  }
  return tools.map((tool, index) =>
    '<tr>' +
    '<td><code>' + tool.name + '</code></td>' +
    '<td>' + (tool.annotations?.title || tool.description) + '</td>' +
    '<td>' +
    '<a class="detail-link" id="tools-toggle-' + index + '" onclick="toggleDetails(\'tools\', ' + index + ')">details</a>' +
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

function generateResourcesTableRows (resources) {
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
    '<a class="detail-link" id="resources-toggle-details-' + index + '" onclick="toggleResourceDetails(\'resources\', ' + index + ', \'details\')">details</a>' +
    ' / ' +
    '<a class="detail-link" id="resources-toggle-resource-' + index + '" onclick="toggleResourceDetails(\'resources\', ' + index + ', \'resource\')">resource</a>' +
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

function generatePromptsTableRows (prompts) {
  if (!prompts || prompts.length === 0) {
    return '<tr><td colspan="2" class="loading-cell">No prompts available</td></tr>';
  }
  return prompts.map((prompt, index) =>
    '<tr>' +
    '<td><code>' + prompt.name + '</code></td>' +
    '<td>' +
    '<a class="detail-link" id="prompts-toggle-details-' + index + '" onclick="togglePromptDetails(\'prompts\', ' + index + ', \'details\')">details</a>' +
    ' / ' +
    '<a class="detail-link" id="prompts-toggle-prompt-' + index + '" onclick="togglePromptDetails(\'prompts\', ' + index + ', \'prompt\')">prompt</a>' +
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

function toggleDetails (sectionName, index) {
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
      switch (sectionName) {
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
          break;
        case 'prompts':
          data = promptsData[index];
          textContent = JSON.stringify(data, null, 2);
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
async function togglePromptDetails (sectionName, index, displayType) {
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
          let errorData = '';
          try {
            errorData = await response.text();
          } catch {
            //
          }
          errorData = [response.statusText || '', errorData].join('. ');
          throw new Error('HTTP ' + response.status + (errorData ? ': ' + errorData : ''));
        }

        const result = await response.json();
        const messages = result.result?.messages || [];
        let promptText = '';

        messages.forEach((msg, i) => {
          if (i > 0) {promptText += '\n\n---\n\n';}
          promptText += 'Role: ' + msg.role + '\n\n';
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
        promptContent.innerHTML = '<pre class="json-content">' + escapeHtml(promptText) + '</pre>';
        addCopyButton(promptContent.querySelector('.json-content'));
      } catch (error) {
        loadingSpinner.style.display = 'none';
        promptContent.style.display = 'block';
        promptContent.innerHTML = '<div class="error-message">Failed to load prompt: ' + escapeHtml(error.message) + '</div>';
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
async function toggleResourceDetails (sectionName, index, displayType) {
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
          let errorData = '';
          try {
            errorData = await response.text();
          } catch {
            //
          }
          errorData = [response.statusText || '', errorData].join('. ');
          throw new Error('HTTP ' + response.status + (errorData ? ': ' + errorData : ''));
        }

        const result = await response.json();
        const contents = result.result?.contents || [];
        let resourceText = '';

        contents.forEach((content, i) => {
          if (i > 0) {resourceText += '\n\n---\n\n';}
          resourceText += 'URI: ' + content.uri + '\n';
          resourceText += 'MIME Type: ' + content.mimeType + '\n\n';

          if (content.text) {
            let processedText = content.text;

            // Handle JSON content more intelligently
            if (content.mimeType === 'application/json') {
              if (typeof processedText !== 'string') {
                processedText = JSON.stringify(processedText, null, 2);
              }
            }
            resourceText += processedText;
          } else if (content.blob) {
            resourceText += '[Binary content: ' + content.blob.length + ' bytes]';
          } else {
            resourceText += JSON.stringify(content, null, 2);
          }
        });

        loadingSpinner.style.display = 'none';
        resourceContent.style.display = 'block';
        resourceContent.innerHTML = '<pre class="json-content">' + escapeHtml(resourceText) + '</pre>';
        addCopyButton(resourceContent.querySelector('.json-content'));
      } catch (error) {
        loadingSpinner.style.display = 'none';
        resourceContent.style.display = 'block';
        resourceContent.innerHTML = '<div class="error-message">Failed to load resource: ' + escapeHtml(error.message) + '</div>';
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
async function openHealthCheckModal () {
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
      let errorData = '';
      try {
        errorData = await response.text();
      } catch {
        //
      }
      errorData = [response.statusText || '', errorData].join('. ');
      throw new Error('HTTP ' + response.status + (errorData ? ': ' + errorData : ''));
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

// Escape HTML to prevent XSS
function escapeHtml (text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Copy to clipboard functionality
function addCopyButton (contentElement) {
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

  copyButton.addEventListener('click', async function () {
    let textToCopy = contentElement.textContent || contentElement.innerText;
    textToCopy = textToCopy.replace(/📋Copied/, '');
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
document.addEventListener('click', function (event) {
  if (event.target.classList.contains('modal-overlay')) {
    const modalId = event.target.id;
    const sectionName = modalId.replace('-modal', '');
    closeModal(sectionName);
  }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
  loadPageData();
});
