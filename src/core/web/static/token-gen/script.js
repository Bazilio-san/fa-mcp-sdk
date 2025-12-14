let keyValuePairCount = 0;

// Set primary color CSS variable
function setPrimaryColor (color) {
  if (color) {
    document.documentElement.style.setProperty('--primary-color', color);
  }
}

function switchTab (tabName) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.getElementById(tabName).classList.add('active');

  // Activate the corresponding tab button
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    const onclick = tab.getAttribute('onclick');
    if (onclick && onclick.includes('switchTab(\'' + tabName + '\')')) {
      tab.classList.add('active');
    }
  });
}

function addKeyValuePair (key = '', value = '', readonly = false, placeholder = 'Value') {
  if (keyValuePairCount >= 15) {
    alert('Maximum of 15 key-value pairs');
    return;
  }
  const container = document.getElementById('keyValuePairs');
  const pairDiv = document.createElement('div');
  pairDiv.className = 'key-value-pair';

  const keyInput = readonly ?
    '<input type="text" placeholder="Key" name="keys" value="' + key + '" readonly style="background-color: #f8f9fa;">' :
    '<input type="text" placeholder="Key" name="keys" value="' + key + '">';

  const valueInput = '<input type="text" placeholder="' + placeholder + '" name="values" value="' + value + '">';

  pairDiv.innerHTML = keyInput + valueInput +
    '<button type="button" class="remove-btn" onclick="removeKeyValuePair(this)">×</button>';
  container.appendChild(pairDiv);
  keyValuePairCount++;
}

function removeKeyValuePair (button) {
  button.parentElement.remove();
  keyValuePairCount--;
}

function addCopyButtonToTokenOutput (tokenOutput, token) {
  if (!tokenOutput || tokenOutput.hasAttribute('data-copy-added')) {
    return;
  }

  tokenOutput.setAttribute('data-copy-added', 'true');

  const copyButton = document.createElement('button');
  copyButton.className = 'copy-button';
  copyButton.innerHTML = '📋';
  copyButton.title = 'Copy to clipboard';
  copyButton.setAttribute('aria-label', 'Copy to clipboard');

  const validateButton = document.createElement('button');
  validateButton.className = 'validate-token-button';
  validateButton.innerHTML = '✓';
  validateButton.title = 'Validate token';
  validateButton.setAttribute('aria-label', 'Validate token');

  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = 'Copied';

  tokenOutput.appendChild(copyButton);
  tokenOutput.appendChild(validateButton);
  tokenOutput.appendChild(notification);

  copyButton.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(token);

      // Show notification
      notification.classList.add('show');

      // Hide notification after 1 second
      setTimeout(() => {
        notification.classList.remove('show');
      }, 1000);

    } catch (err) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = token;
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

  validateButton.addEventListener('click', function () {
    // Switch to validation tab
    switchTab('validate');

    // Set the token in the validation textarea
    const tokenTextarea = document.getElementById('tokenInput');
    if (tokenTextarea) {
      tokenTextarea.value = token;

      // Trigger validation form submit
      const validateForm = document.getElementById('validateForm');
      if (validateForm) {
        validateForm.dispatchEvent(new Event('submit'));
      }
    }
  });
}

function formatTime (ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {return days + ' d. ' + (hours % 24) + ' h.';}
  if (hours > 0) {return hours + ' h. ' + (minutes % 60) + ' min.';}
  if (minutes > 0) {return minutes + ' min.';}
  return seconds + ' s.';
}

// Render authentication status in header
function renderAuthStatus (data) {
  const container = document.getElementById('authStatusContainer');
  if (!container) {return;}

  const { authType, isAuthenticated, user, canLogout } = data;

  // Don't show anything if no auth is configured or not authenticated
  if (!authType || !isAuthenticated || !user) {
    container.style.display = 'none';
    return;
  }

  let html = '<div class="header-auth-info">';
  html += '<img src="/static/token-gen/user.svg" alt="" class="user-icon">';
  html += '<span class="username">' + user + '</span>';
  html += '</div>';

  // Show logout button only for basic and ntlm auth types
  if (canLogout) {
    html += '<button class="header-logout-btn" onclick="logout()" title="Log out">';
    html += '<img src="/static/token-gen/logout.svg" alt="Log out">';
    html += '</button>';
  }

  container.innerHTML = html;
  container.style.display = 'flex';
}

// Load authentication status from API
async function loadAuthStatus () {
  try {
    const response = await fetch('/admin/api/auth-status');
    const data = await response.json();
    if (data.success) {
      renderAuthStatus(data);
    }
  } catch (error) {
    console.error('Error loading auth status:', error);
  }
}

// Processing the Generation Form
document.getElementById('generateForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const keys = formData.getAll('keys').filter(k => k.trim());
  const values = formData.getAll('values').filter(v => v.trim());

  const payload = {};
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] && values[i]) {
      payload[keys[i]] = values[i];
    }
  }

  const requestData = {
    user: formData.get('user'),
    timeValue: parseInt(formData.get('timeValue')),
    timeUnit: formData.get('timeUnit'),
    payload: payload,
  };

  try {
    const response = await fetch('/admin/api/generate-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });

    const result = await response.json();
    const resultDiv = document.getElementById('generateResult');

    if (result.success) {
      resultDiv.innerHTML =
        '<div class="result success">' +
        '<strong>The token has been successfully created!</strong><br>' +
        '<div class="token-output">' + result.token + '</div>' +
        '</div>';

      // Add floating copy button to the token output
      const tokenOutput = resultDiv.querySelector('.token-output');
      if (tokenOutput) {
        addCopyButtonToTokenOutput(tokenOutput, result.token);
      }

      // Automatically populate the validation field with the generated token
      const tokenTextarea = document.getElementById('tokenInput');
      if (tokenTextarea) {
        tokenTextarea.value = result.token;
      }
    } else {
      resultDiv.innerHTML =
        '<div class="result error">' +
        '<strong>Error:</strong> ' + result.error +
        '</div>';
    }
  } catch (error) {
    document.getElementById('generateResult').innerHTML =
      '<div class="result error">' +
      '<strong>Error:</strong> ' + error.message +
      '</div>';
  }
});

// Processing the Verification Form
document.getElementById('validateForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const token = formData.get('token').trim();

  try {
    const response = await fetch('/admin/api/validate-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const result = await response.json();
    const resultDiv = document.getElementById('validateResult');

    if (result.success) {
      const remainingTime = result.payload.expire - Date.now();
      const payloadKeys = Object.keys(result.payload).filter((k) => !/^(user|expire|iat|service)$/.test(k));

      let payloadHtml = '';
      if (payloadKeys.length > 0) {
        payloadHtml = '<h4>Additional data:</h4>';
        payloadKeys.forEach(key => {
          payloadHtml += '<p><strong>' + key + ':</strong> ' + result.payload[key] + '</p>';
        });
      }

      // Format issued at time
      const issuedAtTime = result.payload.iat ? new Date(result.payload.iat).toLocaleString('ru-RU') : 'N/A';

      resultDiv.innerHTML =
        '<div class="result success">' +
        '<strong>The token is valid!</strong>' +
        '<div class="token-info">' +
        '<h4>Token Information:</h4>' +
        '<p><strong>User:</strong> ' + result.payload.user + '</p>' +
        (result.payload.service ? '<p><strong>Service:</strong> ' + result.payload.service + '</p>' : '') +
        '<p><strong>Issued at:</strong> ' + issuedAtTime + '</p>' +
        '<p><strong>Time remaining:</strong> ' + formatTime(remainingTime) + '</p>' +
        '<p><strong>Expires:</strong> ' + new Date(result.payload.expire).toLocaleString('ru-RU') + '</p>' +
        payloadHtml +
        '</div>' +
        '</div>';
    } else {
      resultDiv.innerHTML =
        '<div class="result error">' +
        '<strong>Token invalid!</strong><br>' +
        'Reason: ' + result.error +
        '</div>';
    }
  } catch (error) {
    document.getElementById('validateResult').innerHTML =
      '<div class="result error">' +
      '<strong>Error:</strong> ' + error.message +
      '</div>';
  }
});

// Function to initialize the form
async function initializeForm () {
  try {
    // Getting information about the service
    const response = await fetch('/admin/api/service-info');
    const data = await response.json();
    const serviceName = data.serviceName;

    // Set theme color
    setPrimaryColor(data.primaryColor);

    // Adding a pre-filled pair serviceName
    addKeyValuePair('service', serviceName, true);
    addKeyValuePair('issue', '', true, 'URL of request for the issuance of a token in JIRA');

  } catch (error) {
    console.error('Error loading service info:', error);
  }
  // Add one empty pair for the user
  addKeyValuePair();
}

// Logout function
async function logout () {
  try {
    const response = await fetch('/admin/logout', {
      method: 'GET',
      credentials: 'include',
    });

    if (response.status === 401) {
      // Authentication cleared, reload page to trigger browser auth prompt
      window.location.reload();
    } else {
      console.error('Logout failed');
      alert('Logout failed. Please clear your browser cache and reload the page.');
    }
  } catch (error) {
    console.error('Error during logout:', error);
    alert('Error during logout. Please clear your browser cache and reload the page.');
  }
}

// Initialization on page load
document.addEventListener('DOMContentLoaded', () => {
  loadAuthStatus();
  initializeForm();
});
