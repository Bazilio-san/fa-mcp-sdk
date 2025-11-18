export const getCss = (primaryColor: string) => {
  const primary600 = primaryColor || '#0052cc';
  return `

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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #253858;
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
  border: 1px solid #c1c7d0;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-top: 40px;
}

/* Simple Header */
.simple-header {
  padding: 24px 32px 20px;
  border-bottom: 1px solid #c1c7d0;
  background: #fafbfc;
  border-radius: 6px 6px 0 0;
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
  color: ${primary600};
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
  background: rgba(0, 102, 68, 0.1);
  color: #006644;
}

.status.offline {
  background: rgba(191, 38, 0, 0.1);
  color: #bf2600;
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
  border-radius: 8px;
  box-shadow: 0 4px 8px -2px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31);
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
  background: #fafbfc;
  border-bottom: 1px solid #c1c7d0;
}

.modal-header h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: ${primary600};
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  font-weight: 300;
  color: #505f79;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: #dfe1e6;
  color: #253858;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.table-container {
  overflow-x: auto;
  border-radius: 3px;
  border: 1px solid #c1c7d0;
}

.details-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  font-size: 12px;
}

.details-table th {
  background: #dfe1e6;
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: #253858;
  border-bottom: 2px solid #c1c7d0;
  white-space: nowrap;
}

.details-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #dfe1e6;
  vertical-align: top;
}

.details-table tr:hover {
  background: #fafbfc;
}

.details-table tr:last-child td {
  border-bottom: none;
}

/* Detail row styles */
.detail-row {
  background: #fafbfc;
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
  border: 2px solid #c1c7d0;
  border-top: 2px solid #0065ff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 12px auto;
}

.loading-cell {
  text-align: center;
  padding: 40px 20px;
  color: #505f79;
  font-size: 14px;
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
  color: #bf2600;
  border: 1px solid #ff5630;
  border-radius: 3px;
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 12px;
  text-align: center;
}

.clickable {
  color: #0065ff !important;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s ease;
}

.clickable:hover {
  color: ${primary600};
  text-decoration: underline;
}

.detail-link {
  color: #0065ff;
  text-decoration: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.detail-link:hover {
  color: ${primary600};
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
  border-bottom: 1px solid #dfe1e6;
}

.info-row:last-child {
  border-bottom: none;
}

.label {
  font-weight: 500;
  color: #42526e;
  min-width: 100px;
}

.value {
  text-align: right;
  color: #172b4d;
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 14px;
}

.value.link {
  color: #0065ff;
  text-decoration: none;
}

.value.link:hover {
  color: ${primary600};
  text-decoration: underline;
}

.value.connected {
  color: #006644;
}

.value.disconnected, .value.error {
  color: #bf2600;
}


/* Simple Footer */
.simple-footer {
  padding: 16px 32px;
  background: #fafbfc;
  border-top: 1px solid #c1c7d0;
  border-radius: 0 0 6px 6px;
}

.simple-footer p {
  margin: 0;
  font-size: 12px;
  color: #505f79;
  text-align: center;
}

.simple-footer a {
  color: #0065ff;
  text-decoration: none;
}

.simple-footer a:hover {
  color: ${primary600};
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
  background: #ebecf0;
  border: 1px solid #c1c7d0;
  border-radius: 3px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #505f79;
  font-size: 14px;
  padding: 0;
  z-index: 10;
}

.copy-button:hover {
  background: #dfe1e6;
  border-color: #0052cc;
  color: ${primary600};
}

.copy-button:active {
  transform: scale(0.95);
}

/* Copy Notification */
.copy-notification {
  position: absolute;
  top: 8px;
  right: 40px;
  background: #c1c7d0;
  color: white;
  padding: 4px 8px;
  border-radius: 3px;
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
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 11px;
  line-height: 1.4;
  color: #172b4d;
  white-space: pre-wrap;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  background: #ebecf0;
  padding: 16px;
  padding-right: 48px; /* Extra space for copy button */
  border-radius: 3px;
  border: 1px solid #c1c7d0;
  position: relative;
}

.prompt-content {
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #172b4d;
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
  background: #ebecf0;
  border-radius: 3px;
  border: 1px solid #c1c7d0;
  position: relative;
}

.resource-content {
  font-family: ui-monospace, 'SF Mono', 'Consolas', 'Roboto Mono', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #172b4d;
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
  background: #ebecf0;
  border-radius: 3px;
  border: 1px solid #c1c7d0;
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
