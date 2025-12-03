# MCP Server Template Generator (`fa-mcp`)

CLI utility that creates ready-to-use MCP (Model Context Protocol) server projects from the official template.

## Installation

### Global Installation
```bash
npm install -g fa-mcp-sdk
```

### Local Usage
```bash
npx fa-mcp-sdk
```

## Usage

### Interactive Mode
```bash
fa-mcp
```

### Using Configuration File
```bash
fa-mcp config.json
```

## Configuration

The CLI collects required and optional parameters through interactive prompts or configuration file.

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `project.name` | Package.json name and MCP server identification | `"my-mcp-server"` |
| `project.description` | Package.json description | `"A custom MCP server"` |
| `project.productName` | Display name for UI and documentation | `"My MCP Server"` |
| `port` | Web server port for HTTP and MCP protocol | `"3000"` |

### Optional Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `author.name` | Package.json author name | `""` |
| `author.email` | Package.json author email | `""` |
| `git-base-url` | Git repository base URL | `"github.com/username"` |
| `consul.service.enable` | Enable Consul service registration | `"false"` |
| `consul.agent.reg.token` | Token for registering service with Consul | `"***"` |
| `consul.envCode.dev` | Development environment code | `"<envCode.dev>"` |
| `consul.envCode.prod` | Production environment code | `"<envCode.prod>"` |
| `consul.agent.dev.dc` | Development Consul datacenter | `""` |
| `consul.agent.dev.host` | Development Consul UI host | `"consul.my.ui"` |
| `consul.agent.dev.token` | Development Consul access token | `"***"` |
| `consul.agent.prd.dc` | Production Consul datacenter | `""` |
| `consul.agent.prd.host` | Production Consul UI host | `"consul.my.ui"` |
| `consul.agent.prd.token` | Production Consul access token | `"***"` |
| `mcp.domain` | Domain name for nginx configuration | `""` |
| `ssl-wildcard.conf.rel.path` | Relative path to SSL config in /etc/nginx | `"snippets/ssl-wildcard.conf"` |
| `webServer.auth.enabled` | Enable token authorization | `"false"` |
| `webServer.auth.token.checkMCPName` | Check MCP name in token | `"false"` |
| `isProduction` | Production mode flag | `"false"` |
| `SERVICE_INSTANCE` | Service name suffix for Consul and PM2 | `""` |
| `maintainerUrl` | Support/maintainer URL | `""` |
| `logger.useFileLogger` | Enable file logging | `""` |

### Configuration File Example

```json
{
  "project.name": "my-mcp-server",
  "project.description": "A custom MCP server",
  "project.productName": "My MCP Server",
  "author.name": "John Doe",
  "author.email": "john@example.com",
  "port": "3000",
  "git-base-url": "github.com/username",
  "consul.service.enable": "true",
  "webServer.auth.enabled": "false",
  "isProduction": "false"
}
```

## Generated Project Features

- TypeScript MCP server with HTTP/STDIO transport
- Express.js web server with Swagger documentation
- JWT authentication support (optional)
- Consul service discovery integration (optional)
- File and console logging
- ESLint configuration and Jest testing
- PM2 deployment scripts
- Nginx configuration templates

## Project Structure

```
my-mcp-server/
├── .editorconfig                # Editor configuration
├── .env.example                 # Environment variables template
├── .envrc                       # direnv configuration
├── .gitignore                   # Git ignore rules
├── .run/                        # IDE run configurations
├── config/                      # Environment configurations
│   ├── _local.yaml              # Local configuration template
│   ├── custom-environment-variables.yaml # Environment mapping
│   ├── default.yaml             # Base configuration
│   ├── development.yaml         # Development settings
│   ├── production.yaml          # Production settings
│   └── test.yaml                # Test environment
├── deploy/                      # Deployment configurations
│   ├── .gitkeep                 # Git directory keeper
│   ├── NGINX/                   # Nginx configuration templates
│   │   ├── sites-enabled/       # Nginx site configurations
│   │   └── snippets/            # Nginx configuration snippets
│   ├── config.example.yml       # Deployment config example
│   ├── pm2.config.js            # PM2 process manager config
│   ├── pm2reg.sh                # PM2 registration script
│   ├── srv.cjs                  # Server management script
│   └── srv.sh.readme.md         # Server script documentation
├── scripts/                     # Utility scripts
│   ├── npm/                     # NPM utility scripts
│   ├── kill-port.js             # Port cleanup utility
│   ├── pre-commit               # Git pre-commit hook
│   └── remove-nul.js            # File cleanup utility
├── src/                         # Source code
│   ├── _types_/                 # TypeScript type definitions
│   ├── api/                     # REST API routes
│   │   ├── router.ts            # Express router
│   │   └── swagger.ts           # API documentation
│   ├── asset/                   # Static assets
│   │   └── favicon.svg          # Application favicon
│   ├── prompts/                 # Agent prompts
│   │   ├── agent-brief.ts       # Agent brief
│   │   ├── agent-prompt.ts      # Main agent prompt
│   │   └── custom-prompts.ts    # Custom prompts
│   ├── tools/                   # MCP tool implementations
│   │   ├── handle-tool-call.ts  # Tool execution handler
│   │   └── tools.ts             # Tool definitions
│   ├── custom-resources.ts      # Custom MCP resources
│   └── start.ts                 # Application entry point
├── tests/                       # Test suites
│   ├── mcp/                     # MCP protocol tests
│   ├── jest-simple-reporter.js  # Custom Jest reporter
│   └── utils.ts                 # Test utilities
├── eslint.config.js             # ESLint configuration
├── jest.config.js               # Jest test configuration
├── LICENSE                      # MIT license file
├── package.json                 # NPM package configuration
├── tsconfig.json                # TypeScript configuration
└── update.cjs                   # Project update script
```

Note: The `dist/` directory (compiled JavaScript) is created after running `npm run build`.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start compiled MCP server |
| `npm run build` | Compile TypeScript |
| `npm run cb` | Clean and build |
| `npm run ci` | Install dependencies |
| `npm run reinstall` | Reinstall all dependencies |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint issues |
| `npm test` | Run Jest tests |
| `npm run test:mcp` | Test MCP tools |
| `npm run test:mcp-http` | Test HTTP transport |
| `npm run test:mcp-sse` | Test SSE transport |
| `npm run test:mcp-stdio` | Test STDIO transport |
| `npm run generate-token` | Generate JWT tokens |
| `npm run consul:unreg` | Deregister from Consul |

## Server runs at
`http://localhost:3000` with:
- MCP endpoints at `/mcp/*`
- Swagger UI at `/swagger`
- Health check at `/health`

## Directory Requirements

- **Empty directories only** - CLI aborts if files exist
- Allowed files: `.git`, `.idea`, `.vscode`, `.DS_Store`, `node_modules`, `dist`, `__misc`, `_tmp`, `.swp`, `.swo`, `.sublime-project`, `.sublime-workspace`, `~last-cli-config.json`
- Use absolute paths for target directory

## Deployment

### PM2 Production
```bash
npm run build
pm2 start deploy/pm2.config.js
```

### Systemd Service
```bash
npm run build
chmod +x deploy/srv.cjs
./deploy/srv.cjs install
```

Universal script for systemd service management with auto-detection of Node.js version, ports, and service configuration.

### Consul Registration
Set `consul.service.enable: true` and provide required tokens for automatic service registration.

### Nginx Configuration
Generated nginx configuration files in `deploy/NGINX/` for domain-based routing.

## License

MIT License
