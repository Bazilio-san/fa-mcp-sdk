export const getCss = (primaryColor: string) => {
  return `
:root {
  /* Primary Colors */
  --color-primary-600: ${primaryColor || '#0052cc'};
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

.value.disconnected, .value.error {
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

.MCPServer {
  color: #dddddd;
}

/* Copy Button Styles */
.copy-button {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--color-neutral-90);
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--border-radius-100);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-neutral-600);
  font-size: 14px;
  padding: 0;
  z-index: 10;
}

.copy-button:hover {
  background: var(--color-neutral-100);
  border-color: var(--color-primary-300);
  color: var(--color-primary-600);
}

.copy-button:active {
  transform: scale(0.95);
}

/* Copy Notification */
.copy-notification {
  position: absolute;
  top: 8px;
  right: 40px;
  background: var(--color-neutral-200);
  color: white;
  padding: 4px 8px;
  border-radius: var(--border-radius-100);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-4px);
  transition: all 0.3s ease;
  z-index: 11;
  pointer-events: none;
}

.copy-notification.show {
  opacity: 1;
  transform: translateY(0);
}

/* Content containers with relative positioning for copy button */
.detail-content {
  position: relative;
}

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
  padding-right: 48px; /* Extra space for copy button */
  border-radius: var(--border-radius-100);
  border: 1px solid var(--color-neutral-200);
  position: relative;
}

.prompt-content {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-075);
  line-height: 1.5;
  color: var(--color-neutral-1000);
  max-height: 400px;
  overflow-y: auto;
  position: relative;
}

.prompt-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  padding: 16px;
  padding-right: 48px; /* Extra space for copy button */
  background: var(--color-neutral-90);
  border-radius: var(--border-radius-100);
  border: 1px solid var(--color-neutral-200);
  position: relative;
}

.resource-content {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-075);
  line-height: 1.5;
  color: var(--color-neutral-1000);
  max-height: 400px;
  overflow-y: auto;
  position: relative;
}

.resource-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  padding: 16px;
  padding-right: 48px; /* Extra space for copy button */
  background: var(--color-neutral-90);
  border-radius: var(--border-radius-100);
  border: 1px solid var(--color-neutral-200);
  position: relative;
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

  .copy-button {
    width: 24px;
    height: 24px;
    font-size: 12px;
  }

  .copy-notification {
    font-size: 11px;
    right: 32px;
  }

  .json-content,
  .prompt-content pre,
  .resource-content pre {
    padding-right: 40px;
  }
}`;
};
