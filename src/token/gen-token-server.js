import express from 'express';
import crypto from 'crypto';
import chalk from 'chalk';
import { appConfig } from '../../../dist/src/_core/bootstrap/init-config.js';

const TOKEN_ENCRYPT_KEY = process.env.TOKEN_ENCRYPT_KEY || 'default-secret-key-change-me-in-production';
const PORT = process.env.TOKEN_GEN_PORT || 3030;

const ALGORITHM = 'aes-256-ctr';
const KEY = crypto
  .createHash('sha256')
  .update(String(TOKEN_ENCRYPT_KEY))
  .digest('base64')
  .substring(0, 32);

const tokenRE = /^(\d{13,})\.([\da-fA-F]{32,})$/;

const logger = {
  info: (msg, ...args) => console.log(chalk.cyan('[TOKEN-GEN]'), msg, ...args),
  error: (msg, ...args) => console.error(chalk.red('[TOKEN-GEN ERROR]'), msg, ...args),
};

const encrypt = (text) => {
  const buffer = Buffer.from(text);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encryptedBuf = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
  return encryptedBuf.toString('hex');
};

const decrypt = (encryptedStr) => {
  const encryptedByf = Buffer.from(encryptedStr, 'hex');
  const iv2 = encryptedByf.subarray(0, 16);
  const restBuf = encryptedByf.subarray(16);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv2);
  const decryptedBuf = Buffer.concat([decipher.update(restBuf), decipher.final()]);
  return decryptedBuf.toString();
};

const generateToken = (user, liveTimeSec, payload = {}) => {
  user = (user || '').trim().toLowerCase();
  if (!user) {
    throw new Error('generateToken: Username is empty');
  }
  const expire = Date.now() + (liveTimeSec * 1000);
  payload = typeof payload === 'object' && payload ? payload : {};
  payload.user = user;
  payload.expire = expire;
  return `${expire}.${encrypt(JSON.stringify(payload))}`;
};

const checkToken = (token, expectedUser) => {
  token = (token || '').trim();
  if (!token) {
    return { errorReason: 'Token not passed' };
  }

  const [, expirePartStr, encryptedPayload] = tokenRE.exec(token) || [];

  if (!expirePartStr || !encryptedPayload) {
    return { errorReason: 'Invalid token format' };
  }

  let payloadStr = '';
  try {
    payloadStr = decrypt(encryptedPayload);
  } catch (err) {
    return { errorReason: `Error decrypting JWT token :: ${err.message}` };
  }

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (err) {
    return { errorReason: `Error deserializing payload :: ${err.message}` };
  }

  expectedUser = (expectedUser || '').trim().toLowerCase();
  if (expectedUser && payload.user !== expectedUser) {
    return { errorReason: `User mismatch :: Expected '${expectedUser}', got '${payload.user}'` };
  }

  const expire = Number(expirePartStr) || 0;
  const expiredOn = Date.now() - expire;
  if (expiredOn > 0) {
    return { errorReason: `Token expired :: ${expiredOn} ms ago` };
  }

  return { inTokenType: 'JWT', payload };
};

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const timeToSeconds = {
  minutes: 60,
  hours: 60 * 60,
  days: 60 * 60 * 24,
  months: 60 * 60 * 24 * 30,
  years: 60 * 60 * 24 * 365
};

const getHTMLPage = () => `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Generator & Validator</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .container {
            background: white; border-radius: 20px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 30px; width: 100%; max-width: 800px;
        }
        .tab-container { margin-bottom: 30px; }
        .tabs { display: flex; border-bottom: 2px solid #f0f0f0; margin-bottom: 20px; }
        .tab {
            background: none; border: none; padding: 15px 25px; cursor: pointer; font-size: 16px;
            font-weight: 500; color: #666; border-bottom: 2px solid transparent; transition: all 0.3s ease;
        }
        .tab.active { color: #667eea; border-bottom-color: #667eea; }
        .tab:hover { background: #f9f9f9; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .form-group { margin-bottom: 20px; }
        .form-row { display: flex; gap: 10px; align-items: center; }
        label { display: block; margin-bottom: 5px; font-weight: 500; color: #333; }
        input, select, textarea {
            width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px;
            font-size: 14px; transition: border-color 0.3s ease;
        }
        input:focus, select:focus, textarea:focus { outline: none; border-color: #667eea; }
        .time-input { flex: 1; }
        .time-unit { flex: 0 0 120px; }
        .key-value-pair { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
        .key-value-pair input { margin-bottom: 0; }
        .key-value-pair input[name="keys"] { width: 180px; flex-shrink: 0; }
        .key-value-pair input[name="values"] { flex: 1; }
        .remove-btn {
            background: #ff4757; color: white; border: none; border-radius: 50%; width: 35px; height: 35px;
            cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;
            transition: background 0.3s ease;
        }
        .remove-btn:hover { background: #ff3838; }
        .add-btn {
            background: #2ed573; color: white; border: none; border-radius: 50%; width: 40px; height: 40px;
            cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center;
            margin: 10px auto; transition: background 0.3s ease;
        }
        .add-btn:hover { background: #26d068; }
        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none;
            padding: 15px 30px; border-radius: 10px; font-size: 16px; font-weight: 500; cursor: pointer;
            transition: transform 0.3s ease, box-shadow 0.3s ease; width: 100%; margin-bottom: 20px;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2); }
        .btn:active { transform: translateY(0); }
        .copy-btn { background: #5352ed; padding: 10px 20px; font-size: 14px; width: auto; margin: 10px 0 0 0; }
        .result { margin-top: 20px; padding: 20px; border-radius: 10px; font-family: 'Courier New', monospace; }
        .result.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .result.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .token-output {
            background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 15px;
            font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.4;
            word-break: break-all; min-height: 100px; resize: vertical;
        }
        .token-info {
            background: #e8f5e8; border: 1px solid #d4edda; border-radius: 8px; padding: 15px; margin-top: 15px;
        }
        .token-info h4 { margin-bottom: 10px; color: #155724; }
        .token-info p { margin: 5px 0; font-family: 'Courier New', monospace; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
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
    </div>

    <script>
        let keyValuePairCount = 0;

        function switchTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
        }

        function addKeyValuePair(key = '', value = '', readonly = false, placeholder = "Value") {
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

        function removeKeyValuePair(button) {
            button.parentElement.remove();
            keyValuePairCount--;
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                alert('Token copied to clipboard!');
            });
        }

        function formatTime(ms) {
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
                payload: payload
            };

            try {
                const response = await fetch('/api/generate-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });

                const result = await response.json();
                const resultDiv = document.getElementById('generateResult');

                if (result.success) {
                    resultDiv.innerHTML =
                        '<div class="result success">' +
                            '<strong>The token has been successfully created!</strong><br>' +
                            '<div class="token-output">' + result.token + '</div>' +
                            '<button class="copy-btn" onclick="copyToClipboard(\\'' + result.token + '\\')">Copy Token</button>' +
                        '</div>';
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
                    body: JSON.stringify({ token })
                });

                const result = await response.json();
                const resultDiv = document.getElementById('validateResult');

                if (result.success) {
                    const remainingTime = result.payload.expire - Date.now();
                    const payloadKeys = Object.keys(result.payload).filter(k => k !== 'user' && k !== 'expire');

                    let payloadHtml = '';
                    if (payloadKeys.length > 0) {
                        payloadHtml = '<h4>Additional data:</h4>';
                        payloadKeys.forEach(key => {
                            payloadHtml += '<p><strong>' + key + ':</strong> ' + result.payload[key] + '</p>';
                        });
                    }

                    resultDiv.innerHTML =
                        '<div class="result success">' +
                            '<strong>The token is valid!</strong>' +
                            '<div class="token-info">' +
                                '<h4>Token Information:</h4>' +
                                '<p><strong>User:</strong> ' + result.payload.user + '</p>' +
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
        async function initializeForm() {
            try {
                // Getting information about the service
                const response = await fetch('/api/service-info');
                const data = await response.json();
                const serviceName = data.serviceName;

                // Adding a pre-filled pair serviceName
                addKeyValuePair('service', serviceName, true);
                addKeyValuePair('issue', '', true, 'Reqoest for the issuance of a token');

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

app.get('/', (req, res) => {
  res.send(getHTMLPage());
});

app.post('/api/generate-token', (req, res) => {
  try {
    const { user, timeValue, timeUnit, payload } = req.body;

    if (!user || !timeValue || !timeUnit) {
      return res.json({
        success: false,
        error: 'Need to fill in the user and token lifetime'
      });
    }

    const multiplier = timeToSeconds[timeUnit];
    if (!multiplier) {
      return res.json({
        success: false,
        error: 'Invalid Time Unit'
      });
    }

    const liveTimeSec = timeValue * multiplier;
    const token = generateToken(user, liveTimeSec, payload);

    logger.info(`Generated token for user: ${user}, duration: ${timeValue} ${timeUnit}`);

    res.json({
      success: true,
      token: token
    });

  } catch (error) {
    logger.error('Error generating token:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/validate-token', (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.json({
        success: false,
        error: 'Token Not Transferred'
      });
    }

    const result = checkToken(token);

    if (result.errorReason) {
      return res.json({
        success: false,
        error: result.errorReason
      });
    }

    logger.info(`Token validated successfully for user: ${result.payload?.user}`);

    res.json({
      success: true,
      payload: result.payload,
      tokenType: result.inTokenType
    });

  } catch (error) {
    logger.error('Error validating token:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/service-info', (req, res) => {
  try {
    res.json({
      success: true,
      serviceName: appConfig.name
    });
  } catch (error) {
    logger.error('Error getting service info:', error);
    res.json({
      success: false,
      error: error.message,
      serviceName: 'mcp-server' // fallback
    });
  }
});

app.listen(PORT, () => {
  logger.info(`Token Generator Server started on port ${PORT}`);
  logger.info(`Open http://localhost:${PORT} in your browser`);
  logger.info('Press Ctrl+C to stop the server');
});

export default app;
