import { encodeSvgForDataUri } from '../../utils/utils.js';
const jwtSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0052cc" d="M10.2 0v6.5L12 8.9l1.8-2.4V0Zm3.6 6.5v3l3-1 3.7-5.1-2.9-2.2zm3 2-1.9 2.6 3 1 6.1-2-1.1-3.5Zm1 3.5L15 13l1.8 2.5 6.2 2 1-3.5Zm-1 3.5-3-1v3l3.8 5.3 3-2.1zm-3 2L12 15.2l-1.8 2.5V24h3.6zm-3.6 0v-3l-3 1-3.7 5.2 2.9 2.1zm-3-2 2-2.5-3-1L0 14l1.1 3.5Zm-1-3.5L9 11 7.3 8.7 1 6.6 0 10Zm1-3.4 3 1V6.4L6.4 1.2l-3 2.2Z"/></svg>';
const iconEncoded = encodeSvgForDataUri(jwtSvg);

export const getHTMLPage = (): string => `<!DOCTYPE html>
<html lang='ru'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0'>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${iconEncoded}">
  <title>Token Generator & Validator</title>
  
  <style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #253858;
  background: white;
  margin: 0;
  padding: 24px;
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
  border: 1px solid #c1c7d0;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31);
  margin-top: 40px;
}

/* Simple Header */
.simple-header {
  padding: 16px 24px 12px;
  border-bottom: 1px solid #c1c7d0;
  background: #fafbfc;
  border-radius: 6px 6px 0 0;
  display: flex;
  align-items: center;
  gap: 16px;
}

.simple-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: #0052cc;
}

/* Simple Main Content */
.simple-main {
  padding: 24px 24px;
}

.tab-container {
  margin-bottom: 0;
}

.tabs {
  display: flex;
  border-bottom: 1px solid #c1c7d0;
  margin-bottom: 24px;
}

.tab {
  background: none;
  border: none;
  padding: 12px 16px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #505f79;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
}

.tab.active {
  color: #0052cc;
  border-bottom-color: #0052cc;
}

.tab:hover {
  color: #253858;
  background: #fafbfc;
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

.form-group {
  margin-bottom: 12px;
}

.form-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
  color: #42526e;
  font-size: 14px;
}

input, select, textarea {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #c1c7d0;
  border-radius: 3px;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  background: white;
}

select {
  padding: 3px 6px;
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: #0065ff;
  box-shadow: 0 0 0 2px rgba(0, 101, 255, 0.1);
}

input::placeholder, textarea::placeholder {
  color: #505f79;
}

.time-input {
  flex: 1;
}

.time-unit {
  flex: 0 0 120px;
}

.key-value-pair {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.key-value-pair input {
  margin-bottom: 0;
}

.key-value-pair input[name="keys"] {
  width: 180px;
  flex-shrink: 0;
}

.key-value-pair input[name="values"] {
  flex: 1;
}

.remove-btn {
  background: white;
  color: #bf2600;
  border: 0px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.remove-btn:hover {
  background: #bf2600;
  color: white;
  border-color: #bf2600;
}

.add-btn {
  background: #d7ffd4;
  color: #089300;
  border: none;
  border-radius: 14px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 24px;
  font-weight: 500;
  align-items: center;
  transition: background 0.2s ease;
}

.add-btn:hover {
  background: #c9ffc4;
}

.btn {
  background: #0052cc;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 3px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
  margin-bottom: 16px;
}

.btn:hover {
  background: #0065ff;
  box-shadow: 0 1px 1px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31);
}

.btn:active {
  transform: translateY(1px);
  box-shadow: none;
}


.result {
  margin-top: 24px;
  padding: 24px;
  border-radius: 3px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
}

.result.success {
  background: rgba(0, 102, 68, 0.1);
  color: #006644;
  border: 1px solid rgba(0, 102, 68, 0.2);
}

.result.error {
  background: rgba(191, 38, 0, 0.1);
  color: #bf2600;
  border: 1px solid rgba(255, 86, 48, 0.2);
}

.token-output {
  background: #ebecf0;
  border: 1px solid #c1c7d0;
  border-radius: 3px;
  padding: 16px;
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  min-height: 100px;
  resize: vertical;
  color: #172b4d;
  position: relative;
}

.copy-button, .validate-token-button {
  position: absolute;
  bottom: 5px;
  right: 35px;
  background: #ffffff73;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  transition: all 0.2s ease;
  z-index: 10;
}

.validate-token-button {
  right: 5px;
}

.copy-button:hover, .validate-token-button:hover {
  background: #ffffff;
  transform: scale(1.05);
}

.copy-notification {
  position: absolute;
  top: 8px;
  right: 42px;
  background: #006644;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  opacity: 0;
  transform: translateY(-10px);
  transition: all 0.3s ease;
  z-index: 11;
  white-space: nowrap;
}

.copy-notification.show {
  opacity: 1;
  transform: translateY(0);
}

.token-info {
  background: rgba(0, 102, 68, 0.05);
  border: 1px solid rgba(0, 102, 68, 0.1);
  border-radius: 3px;
  padding: 16px;
  margin-top: 12px;
}

.token-info h4 {
  margin-bottom: 8px;
  color: #006644;
  font-weight: 600;
  font-size: 14px;
}

.token-info p {
  margin: 4px 0;
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 14px;
  color: #172b4d;
}
.service-icon {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.service-icon svg {
  width: 100%;
  height: 100%;
}
/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .simple-container {
    margin-top: 24px;
    max-width: 100%;
  }

  .simple-header {
    padding: 16px 20px 12px;
  }

  .simple-header h1 {
    font-size: 20px;
  }

  .simple-main {
    padding: 20px 20px;
  }

  .form-row {
    flex-direction: column;
    gap: 8px;
  }

  .key-value-pair {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .key-value-pair input[name="keys"] {
    width: 100%;
  }

  .remove-btn {
    width: 100%;
    margin-top: 8px;
  }
}
  </style>
</head>
<body>
<div class="simple-container">
  <!-- Header -->
  <header class="simple-header">
    <div class="service-icon">${jwtSvg}</div>
    <h1>Token Generator & Validator</h1>
  </header>

  <!-- Main Content -->
  <main class="simple-main">
    <div class="tab-container">
      <div class="tabs">
        <button class="tab active" onclick="switchTab('generate')">Token generation</button>
        <button class="tab" onclick="switchTab('validate')">Token validation</button>
      </div>

    <!-- Token generation -->
    <div id="generate" class="tab-content active">
      <form id="generateForm">
        <div class="form-group">
          <div class="form-row" style="gap: 20px;">
            <div style="flex: 1;">
              <label for="tokenUser">Who is the token issued to:</label>
              <input type="text" id="tokenUser" name="user" required>
            </div>
            <div style="flex: 1;">
              <label>For how long:</label>
              <div class="form-row">
                <input type="number" id="timeValue" name="timeValue" class="time-input" min="1" required>
                <select id="timeUnit" name="timeUnit" class="time-unit">
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days" selected>days</option>
                  <option value="months">months</option>
                  <option value="years">years</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Additional data (key-value):</label>
          <div id="keyValuePairs"></div>
          <button type="button" class="add-btn" onclick="addKeyValuePair()">+</button>
        </div>
        <button type="submit" class="btn">Generate a token</button>
      </form>
      <div id="generateResult"></div>
    </div>

    <!-- Token validation -->
    <div id="validate" class="tab-content">
      <form id="validateForm">
        <div class="form-group">
          <label for="tokenInput">Enter the token for verification:</label>
          <textarea id="tokenInput" name="token" rows="4" required></textarea>
        </div>
        <button type="submit" class="btn">Check Token</button>
      </form>
      <div id="validateResult"></div>
    </div>
    </div>
  </main>
</div>

<script>
let keyValuePairCount = 0;

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
    if (onclick && onclick.includes("switchTab('" + tabName + "')")) {
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

function addCopyButtonToTokenOutput(tokenOutput, token) {
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

  copyButton.addEventListener('click', async function() {
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

  validateButton.addEventListener('click', function() {
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

  if (days > 0) return days + ' d. ' + (hours % 24) + ' h.';
  if (hours > 0) return hours + ' h. ' + (minutes % 60) + ' min.';
  if (minutes > 0) return minutes + ' min.';
  return seconds + ' s.';
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
    const response = await fetch('/api/generate-token', {
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
    const response = await fetch('/api/validate-token', {
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
        ( result.payload.service ? '<p><strong>Service:</strong> ' + result.payload.service + '</p>' : '') +
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
    const response = await fetch('/api/service-info');
    const data = await response.json();
    const serviceName = data.serviceName;

    // Adding a pre-filled pair serviceName
    addKeyValuePair('service', serviceName, true);
    addKeyValuePair('issue', '', true, 'URL of request for the issuance of a token in JIRA');

  } catch (error) {
    console.error('Error loading service info:', error);
  }
  // Add one empty pair for the user
  addKeyValuePair();
}

// Initialization on page load
initializeForm();
</script>
</body>
</html>
`;
