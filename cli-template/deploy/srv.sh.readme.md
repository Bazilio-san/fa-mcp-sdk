# srv.sh - Unified systemd Service Management Script

Universal script for managing systemd services for Node.js applications. Consolidates functionality from separate `deploy/systemd-service/` scripts into a single solution.

## Features

- ✅ **Universal execution**: Works the same when launched from project root or from `deploy/` folder
- ✅ **Auto-detection of Node.js version**: Priority: parameter → .envrc → current version
- ✅ **Smart Node.js search**: NVM paths → system paths
- ✅ **Automatic configuration reading**: package.json, config for port
- ✅ **systemd unit file generation**: Correct paths and settings
- ✅ **Process management**: Stops processes on ports when removing

## Operation Algorithm

### Working Directory Determination

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"    # Script folder: /path/to/project/deploy/
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"                      # Project root: /path/to/project/
```

**Result**: Regardless of launch location, the script always uses the project root for:
- Reading `package.json`
- Reading `.envrc`
- Reading configuration
- Setting `WorkingDirectory` in systemd unit

### Node.js Version Detection Algorithm

1. **Parameter `-v <version>`** (highest priority)
   ```bash
   ./deploy/srv.sh install -v 20.10.0
   ```

2. **`.envrc` file in project root**
   ```bash
   # Searches for line like:
   nvm use 22.17.1
   # Extracts: 22.17.1
   ```

3. **Current Node.js version** (fallback)
   ```bash
   node -v  # For example: v22.17.1 → 22.17.1
   ```

### Node.js Path Search Algorithm

1. **NVM path** (priority)
   ```bash
   $HOME/.nvm/versions/node/v22.17.1/bin/node
   ```

2. **System path** (fallback)
   ```bash
   which node  # For example: /usr/bin/node
   ```

### Service Name Detection Algorithm

1. **Parameter `-n <name>`** (priority)
2. **`name` value from package.json** (default)

### Port Detection Algorithm

1. **Parameter `-p <port>`** (priority)
2. **`config.webServer.port` value** (automatic)
   ```javascript
   // Executed from project root:
   const config = require('config');
   console.log(config.webServer?.port);
   ```

## Commands

### Service Installation

```bash
# Basic installation (auto-detect all parameters)
./deploy/srv.sh install
./deploy/srv.sh i

# With custom service name
./deploy/srv.sh install -n my-custom-service

# With specific Node.js version
./deploy/srv.sh install -v 20.10.0

# Combined parameters
./deploy/srv.sh i -n custom-service -v 22.17.1
```

**What happens:**
1. Node.js version and binary path are determined
2. `package.json` is read to get `main` and `name`
3. systemd unit file is generated in `/etc/systemd/system/<service_name>.service`
4. `systemctl daemon-reload` is executed
5. `systemctl enable --now <service_name>` is executed

### Service Removal

```bash
# Auto-detect port from config
./deploy/srv.sh delete
./deploy/srv.sh d

# With custom service name
./deploy/srv.sh delete -n custom-service

# With specific port
./deploy/srv.sh delete -p 8080

# Combined parameters
./deploy/srv.sh d -n custom-service -p 9021
```

**What happens:**
1. Port is determined from configuration or parameter
2. `systemctl stop <service_name>` is executed
3. `systemctl disable <service_name>` is executed
4. Unit file `/etc/systemd/system/<service_name>.service` is removed
5. Process on specified port is terminated (if exists)
6. `systemctl daemon-reload` is executed

### Service Reinstallation

```bash
# Complete reinstallation
./deploy/srv.sh reinstall
./deploy/srv.sh r

# With parameters
./deploy/srv.sh r -n custom-service -v 22.17.1 -p 9021
```

**What happens:**
1. Complete service removal is performed (as in `delete`)
2. Complete service installation is performed (as in `install`)
3. Status is shown and log viewing is started

## Execution Examples

### From Project Root

```bash
# All commands work from root
./deploy/srv.sh install
./deploy/srv.sh delete -p 9021
./deploy/srv.sh reinstall -n mcp-fin-office-dev
```

### From deploy Folder

```bash
cd deploy/

# All commands work from deploy folder
./srv.sh install
./srv.sh delete -p 9021
./srv.sh reinstall -n mcp-fin-office-dev
```

### Real-world Project Examples

```bash
# Development installation
./deploy/srv.sh install -n mcp-fin-office-dev -v 22.17.1

# Production installation with auto-detection
./deploy/srv.sh install

# Remove dev version
./deploy/srv.sh delete -n mcp-fin-office-dev

# Quick reinstall after changes
./deploy/srv.sh reinstall
```

## Generated systemd Unit File

```ini
[Unit]
Description=mcp-fin-office
After=network.target
StartLimitIntervalSec=0

[Service]
User=root
WorkingDirectory=/path/to/project/root
EnvironmentFile=/path/to/project/root/.env
ExecStart=/root/.nvm/versions/node/v22.17.1/bin/node dist/src/_core/index.js
Restart=always
RestartSec=3
StandardOutput=syslog
StandardError=syslog

[Install]
WantedBy=multi-user.target
```

## Debugging and Monitoring

### View Status

```bash
systemctl status mcp-fin-office
```

### View Logs

```bash
# Recent logs
journalctl -u mcp-fin-office

# Follow logs in real-time
journalctl -u mcp-fin-office -f

# Logs from last hour
journalctl -u mcp-fin-office --since "1 hour ago"
```

### Manual Control

```bash
# Stop
sudo systemctl stop mcp-fin-office

# Start
sudo systemctl start mcp-fin-office

# Restart
sudo systemctl restart mcp-fin-office

# Disable autostart
sudo systemctl disable mcp-fin-office
```

## Requirements

- **Operating System**: Linux with systemd
- **Permissions**: `sudo` privileges for managing systemd services
- **Node.js**: Installed Node.js (NVM or system installation)
- **Project Files**:
  - `package.json` in project root
  - Built application (file specified in `package.json` `main`)
  - Optional: `.envrc` for Node.js version detection
  - Optional: `config/` folder for port detection

## File Structure

```
project-root/
├── package.json              # Source: name, main
├── .envrc                    # Optional: Node.js version
├── config/
│   └── default.yaml         # Optional: webServer.port
├── deploy/
│   ├── srv.sh              # ← This script
│   └── srv.sh.readme.md    # ← This documentation
└── dist/
    └── src/
        └── _core/
            └── index.js     # Main application file
```

## Troubleshooting

### Script Cannot Find Node.js

```bash
# Check Node.js availability
node -v
which node

# Check NVM installation
ls -la ~/.nvm/versions/node/
```

### package.json Reading Error

```bash
# Check JSON syntax
cat package.json | jq .

# Check for name and main fields
node -e "const pkg = require('./package.json'); console.log('name:', pkg.name); console.log('main:', pkg.main);"
```

### Port Detection Error

```bash
# Check configuration
node -e "const c = require('config'); console.log('port:', c.webServer?.port);"

# Check configuration files
ls -la config/
cat config/default.yaml | grep -A5 webServer
```

### Access Permissions

```bash
# Check systemd management permissions
sudo systemctl --version

# Check write permissions for /etc/systemd/system/
sudo ls -la /etc/systemd/system/
```

## CI/CD Integration

### Automated Deployment

```bash
#!/bin/bash
# deploy.sh

# Build project
npm ci
npm run build

# Install/reinstall service
./deploy/srv.sh reinstall

# Check successful startup
sleep 5
systemctl is-active --quiet mcp-fin-office && echo "Service started successfully"
```

### Rollback Script

```bash
#!/bin/bash
# rollback.sh

# Stop current service
./deploy/srv.sh delete

# Restore previous version
git checkout HEAD~1
npm ci
npm run build

# Start previous version
./deploy/srv.sh install
```
