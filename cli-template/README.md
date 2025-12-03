# {{project.productName}}

{{project.description}}

## Install & Run

### Quick Start
```bash
# Install
npm install

# Configure (copy config/local.yaml from config/_local.yaml)
# Add database credentials

# Build
npm run build

# Run (STDIO mode for Claude Desktop)
npm start
```

### Test Run
```bash
# Unit tests
npm test

# MCP protocol tests
npm run test:mcp        # STDIO mode
npm run test:mcp-http   # HTTP mode
npm run test:mcp-simple # Simple test
```

### Dual Transport System

**STDIO Mode** (default for Claude Desktop):
- Direct stdin/stdout communication
- Optimal for Claude Desktop integration
- No network ports required

**HTTP Mode** (web integration):
- HTTP server with Server-Sent Events (SSE)
- About page with server status at `http://localhost:{{port}}/`
- Health check endpoint at `/health`
- Direct JSON-RPC 2.0 endpoint at `/mcp`


## Features



## MCP Tools



## MCP Prompts

### `agent_brief`
Brief description of agent capabilities for agent selection.

### `agent_prompt`
Complete prompt with instructions.

## MCP Resources

### `staff://agent/brief`
Same as `agent_brief` prompt. **MIME:** text/plain

### `staff://agent/prompt`
Same as `agent_prompt` prompt. **MIME:** text/plain


## 2. Configuration

**Option A: Configuration File**

**Option B: Environment Variables**


## Claude Desktop Setup

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "{{project.name}}": {
      "command": "node",
      "args": [
        "<path-to-project>/mcp-staff-db/dist/src/index.js"
      ],
      "env": {
      }
    }
  }
}
```

## HTTP Mode Endpoints

- **/** - About page
- **/health** - Health check
- **/sse** - Server-Sent Events
- **/mcp** - JSON-RPC 2.0

## Security
