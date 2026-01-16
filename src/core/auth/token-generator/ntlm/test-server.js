// A simple test version of the server to verify NTLM authentication
import express from 'express';

const app = express();
const port = 3030;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Easy NTLM middleware simulation for testing
app.use((req, res, next) => {
  const auth = req.headers.authorization;

  if (!auth) {
    // Sending NTLM challenge
    console.log('[TEST-SERVER] No auth header, sending NTLM challenge');
    return res
      .setHeader('WWW-Authenticate', 'NTLM')
      .status(401)
      .send(`
<!DOCTYPE html>
<html>
<head><title>NTLM Authentication</title></head>
<body>
  <h2>NTLM Authentication Required</h2>
  <form id="authForm">
    <div>
      <label>Username: <input type="text" id="login" placeholder="domain\\username"></label>
    </div>
    <div>
      <label>Password: <input type="password" id="password"></label>
    </div>
    <button type="button" onclick="authenticate()">Sign In</button>
  </form>

  <script>
    function authenticate() {
      const login = document.getElementById('login').value;
      const password = document.getElementById('password').value;
      const wl = window.location;
      window.location.href = wl.protocol + '//' + login + ':' + password + '@' + wl.hostname + ':' + wl.port;
    }
  </script>
</body>
</html>`);
  }

  if (auth.startsWith('Basic ')) {
    // Simple NTLM simulation - decode Basic auth
    const base64Credentials = auth.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username] = credentials.split(':');

    // Mitigate the NTLM object
    req.ntlm = {
      username: username.includes('\\') ? username.split('\\')[1] : username,
      domain: username.includes('\\') ? username.split('\\')[0] : 'OFFICE',
      workstation: 'TEST-WS',
      isAuthenticated: true,
    };

    console.log(`[TEST-SERVER] User authenticated: ${req.ntlm.domain}\\${req.ntlm.username}`);
  }

  next();
});

app.get('/', (req, res) => {
  const username = req.ntlm?.username || 'Unknown';
  const domain = req.ntlm?.domain || 'Unknown';
  console.log(`[TEST-SERVER] Main page accessed by: ${domain}\\${username}`);

  res.send(`
<!DOCTYPE html>
<html>
<head><title>Token Generator Test</title></head>
<body>
  <h1>Token Generator & Validator (Test Mode)</h1>
  <p><strong>Authenticated User:</strong> ${domain}\\${username}</p>

  <h2>Generate Token</h2>
  <form id="generateForm">
    <div>
      <label>User: <input type="text" name="user" required></label>
    </div>
    <div>
      <label>Duration: <input type="number" name="timeValue" value="1" required></label>
      <select name="timeUnit">
        <option value="hours">Hours</option>
        <option value="days">Days</option>
      </select>
    </div>
    <button type="submit">Generate Token</button>
  </form>

  <div id="result"></div>

  <script>
    document.getElementById('generateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      const response = await fetch('/api/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: data.user,
          timeValue: parseInt(data.timeValue),
          timeUnit: data.timeUnit,
          payload: { service: 'test-server' }
        })
      });

      const result = await response.json();
      document.getElementById('result').innerHTML =
        result.success ?
        '<div style="color: green;">Token generated successfully!</div>' :
        '<div style="color: red;">Error: ' + result.error + '</div>';
    });
  </script>
</body>
</html>`);
});

// API endpoints
app.post('/api/generate-token', (req, res) => {
  const username = req.ntlm?.username || 'Unknown';
  const domain = req.ntlm?.domain || 'Unknown';
  console.log(`[TEST-SERVER] Token generation by: ${domain}\\${username}`);

  const { user, timeValue, timeUnit } = req.body;

  if (!user || !timeValue || !timeUnit) {
    return res.json({
      success: false,
      error: 'Missing required fields',
    });
  }

  // Simulating token generation
  const token = 'test-token-' + Date.now();

  res.json({
    success: true,
    token: token,
    message: `Token generated for ${user} by ${domain}\\${username}`,
  });
});

app.get('/api/service-info', (req, res) => {
  const username = req.ntlm?.username || 'Unknown';
  const domain = req.ntlm?.domain || 'Unknown';
  console.log(`[TEST-SERVER] Service info by: ${domain}\\${username}`);

  res.json({
    success: true,
    serviceName: 'test-token-server',
    authenticatedUser: `${domain}\\${username}`,
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`[TEST-SERVER] Token Generator Test Server started on port ${port}`);
  console.log(`[TEST-SERVER] Open http://localhost:${port} in your browser`);
  console.log('[TEST-SERVER] Press Ctrl+C to stop the server');
});
