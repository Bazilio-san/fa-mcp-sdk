/**
 * NTLM Authentication HTML Templates
 * Converted from pug templates in src/core/_ntlm_example/ntlm/views/
 */

// CSS styles from src/core/_ntlm_example/style.css
const ntlmStyles = `
body, html {
  height: 100%;
  margin: 0;
  font-family: "Roboto", "-apple-system", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.views-outer-container {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 14px;
}

.views-auth-container {
  text-align: center;
  position: absolute;
  top: calc(38vh - 130px);
}

.views-auth-container svg {
  width: 70px;
  fill: rgba(194, 57, 52, 0.58);
}

.views-auth-block {
  border: 1px solid #d0d0d0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.views-input-group {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.views-input-group label {
  width: 80px;
  text-align: left;
  margin-right: 10px;
}

.views-input-group input {
  padding: 5px;
  width: 200px;
}

.views-input-group input::placeholder {
  color: #e5e5e5;
}

input {
  outline: none;
  border: 1px solid #b0b0b0;
}

input:focus {
  border: 1px solid #ff5500;
}

.views-button-container {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: end;
}

.views-button-container button {
  padding: 3px;
  width: 105px;
}
`;

// SVG icon from src/core/_ntlm_example/block-visitor.svg
const blockVisitorSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="#c23934" d="M29.9 8.8V9v-.2z"/>
  <path fill="#c23934"
        d="M10.2 17.1c0-1.3.4-2.7 1-3.8.8-1.4 1.7-1.9 2.4-3 1.1-1.7 1.4-4.1.6-6-.7-1.9-2.5-3-4.5-2.9S6 2.7 5.4 4.6c-.8 2-.5 4.5 1.2 6.1.7.7 1.3 1.7 1 2.6-.4 1-1.5 1.4-2.2 1.7-1.8.8-4 1.9-4.4 4.1-.4 1.7.8 3.5 2.7 3.5h7.9c.4 0 .6-.4.4-.7-1.2-1.4-1.8-3.1-1.8-4.8zm11.3-3.9c-2.2-2.2-5.7-2.2-7.9 0s-2.2 5.6 0 7.8 5.7 2.2 7.9 0 2.1-5.7 0-7.8zm-6.6 1.2c1.3-1.2 3.1-1.4 4.5-.5l-5 5.1c-.9-1.5-.7-3.3.5-4.6zm5.3 5.3c-1.3 1.2-3.1 1.4-4.6.6l5.1-5.1c.9 1.4.7 3.3-.5 4.5z"/>
</svg>`;

/**
 * Basic login page template
 */
export const getLoginPageHTML = (username: string = ''): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in</title>
  <style>${ntlmStyles}</style>
</head>
<body>
  <script>
    const username = '${username}';
    function authenticate() {
      const wl = window.location;
      const login = document.getElementById('login').value;
      const password = document.getElementById('password').value;

      // Special handling for NTLM authentication
      // The @ symbol in passwords breaks URL construction, so we need proper URL encoding
      try {
        // Properly encode the credentials for URL
        const encodedLogin = encodeURIComponent(login);
        const encodedPassword = encodeURIComponent(password);

        console.log('Attempting authentication with:', { login: encodedLogin, passwordLength: password.length });

        // Navigate with properly encoded credentials
        window.location.href = wl.protocol + '//' + encodedLogin + ':' + encodedPassword + '@' + wl.hostname + ':' + wl.port;
      } catch (error) {
        console.error('Authentication error:', error);
        alert('Authentication failed: ' + error.message);
      }
    }

    // For testing: add direct NTLM trigger function
    function triggerNTLM() {
      // This will trigger the browser's native NTLM authentication dialog
      const wl = window.location;
      window.location.href = wl.origin + '/';
    }

    // Add additional button for testing
    document.addEventListener('DOMContentLoaded', function() {
      const buttonContainer = document.querySelector('.views-button-container');
      if (buttonContainer) {
        const ntlmButton = document.createElement('button');
        ntlmButton.type = 'button';
        ntlmButton.textContent = 'Trigger NTLM Dialog';
        ntlmButton.style.marginTop = '10px';
        ntlmButton.onclick = triggerNTLM;
        buttonContainer.appendChild(ntlmButton);
      }
    });
  </script>
  <div class="views-outer-container">
    <div class="views-auth-container">
      <div class="views-auth-block">
        <div class="views-input-group">
          <label for="login">Login:</label>
          <input type="text" id="login" value="${username}">
        </div>
        <div class="views-input-group">
          <label for="password">Password:</label>
          <input type="password" id="password">
        </div>
        <div class="views-button-container">
          <button type="button" onclick="authenticate()">Sign in</button>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

/**
 * Not authenticated page template (wrong login/password)
 */
export const getNotAuthenticatedPageHTML = (title: string = 'NOT AUTHENTICATED', protocol: string = '', hostname: string = '', username: string = ''): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${ntlmStyles}</style>
</head>
<body>
  <script>
    const username = '${username}';
    function authenticate() {
      const protocol = '${protocol}';
      const hostname = '${hostname}';
      const login = document.getElementById('login').value;
      const password = document.getElementById('password').value;
      window.location.href = protocol + '://' + login + ':' + password + '@' + hostname;
    }
  </script>
  <div class="views-outer-container">
    <div class="views-auth-container">
      ${blockVisitorSvg}
      <p>Wrong login or password</p>
      <div class="views-auth-block">
        <div class="views-input-group">
          <label for="login">Login:</label>
          <input type="text" id="login" value="${username}">
        </div>
        <div class="views-input-group">
          <label for="password">Password:</label>
          <input type="password" id="password">
        </div>
        <div class="views-button-container">
          <button type="button" onclick="authenticate()">Sign in</button>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

/**
 * Not authorized page template (user doesn't have access)
 */
export const getNotAuthorizedPageHTML = (title: string = 'NOT AUTHORIZED', username: string = ''): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${ntlmStyles}</style>
</head>
<body>
  <div class="views-outer-container">
    <div class="views-auth-container">
      ${blockVisitorSvg}
      <p>No access for "${username}"</p>
    </div>
  </div>
</body>
</html>`;

/**
 * 404 page template
 */
export const get404PageHTML = (): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Page Not Found</title>
  <style>${ntlmStyles}</style>
</head>
<body>
  <div class="views-outer-container">
    <div class="views-auth-container">
      ${blockVisitorSvg}
      <p>404 - Page Not Found</p>
    </div>
  </div>
</body>
</html>`;
