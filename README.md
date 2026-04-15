# MCP Server Template Generator

Production-ready core framework for building MCP (Model Context Protocol) servers with comprehensive
infrastructure support.

CLI utility that creates ready-to-use MCP (Model Context Protocol) server projects from the official template.

## Overview

This framework provides complete infrastructure for building enterprise-grade MCP servers:

- **Dual Transport**: STDIO (Claude Desktop) and HTTP/SSE (web clients)
- **Agent-Driven Tool Development**: Built-in AI agent system (Agent Tester) for iterative refinement of MCP tools through automated testing cycles — the agent calls your tools, you observe behavior, adjust descriptions/parameters/prompts, and re-test
- **Headless Test API**: Direct HTTP endpoint (`POST /agent-tester/api/chat/test`) returns structured trace of every tool call, argument, result, and LLM decision — enabling CLI-based automated testing without a browser
- **Authentication**: JWT (with optional IP restriction), Basic auth, permanent tokens, custom validators
- **Database Integration**: PostgreSQL with pgvector for vector operations
- **Service Discovery**: Consul integration for microservices
- **Rate Limiting**: Configurable rate limiting for all endpoints
- **API Documentation**: Automatic Swagger/OpenAPI generation
- **Production Logging**: Structured logging with data masking
- **Configuration Management**: YAML-based with environment overrides
- **Deployment Ready**: PM2 scripts, Nginx templates, ESLint, Jest testing

The framework uses dependency injection to keep the core completely agnostic of project-specific implementations.


## Steps to Get Started

1) Install `fa-mcp-sdk` globally:

   ```bash
   npm install -g fa-mcp-sdk
   ```

2) Run the CLI, specify the target directory, and follow the interactive prompts:

   ```bash
   fa-mcp
   ```
   Or using configuration file:
    
   ```bash
   fa-mcp config.yaml
   ```

3) Launching the template MCP server:
   - Navigate to the target directory: `cd <targetPath>`
   - Install dependencies: `npm install`
   - Build the project: `npm run build`
   - Start the server: `npm start`

4) Vibe-coding your MCP server logic:
   - Create an instruction file (prompt) for your preferred AI coding assistant.
     `fa-mcp-sdk` comes ready for use with `Claude Code`.
     You can find an example prompt for creating an MCP server (e.g., a currency exchange rate provider) in `cli-template/prompt-example-new-MCP.md`.
   - Launch your AI coder and provide it with the instructions to build your new MCP server.



## Configuration

The CLI collects required and optional parameters through interactive prompts or configuration file.

### Required Parameters

| Parameter             | Description | Example |
|-----------------------|-------------|---------|
| `project.name`        | Package.json name and MCP server identification | `"my-mcp-server"` |
| `project.description` | Package.json description | `"A custom MCP server"` |
| `project.productName` | Display name for UI and documentation | `"My MCP Server"` |
| `port`                | Web server port for HTTP and MCP protocol | `"3000"` |

### Optional Parameters

| Parameter                           | Description | Default |
|-------------------------------------|-------------|---------|
| `author.name`                       | Package.json author name | `""` |
| `author.email`                      | Package.json author email | `""` |
| `git-base-url`                      | Git repository base URL | `"github.com/username"` |
| `consul.service.enable`             | Enable Consul service registration | `"false"` |
| `consul.agent.reg.token`            | Token for registering service with Consul | `"***"` |
| `consul.envCode.dev`                | Development environment code | `"<envCode.dev>"` |
| `consul.envCode.prod`               | Production environment code | `"<envCode.prod>"` |
| `consul.agent.dev.dc`               | Development Consul datacenter | `""` |
| `consul.agent.dev.host`             | Development Consul UI host | `"consul.my.ui"` |
| `consul.agent.dev.token`            | Development Consul access token | `"***"` |
| `consul.agent.prd.dc`               | Production Consul datacenter | `""` |
| `consul.agent.prd.host`             | Production Consul UI host | `"consul.my.ui"` |
| `consul.agent.prd.token`            | Production Consul access token | `"***"` |
| `mcp.domain`                        | Domain name for nginx configuration | `""` |
| `ssl-wildcard.conf.rel.path`        | Relative path to SSL config in /etc/nginx | `"snippets/ssl-wildcard.conf"` |
| `webServer.auth.enabled`            | Enable token authorization | `"false"` |
| `webServer.auth.token.checkMCPName` | Check MCP name in token | `"false"` |
| `isProduction`                      | Production mode flag | `"false"` |
| `SERVICE_INSTANCE`                  | Service name suffix for Consul and PM2 | `""` |
| `maintainerUrl`                     | Support/maintainer URL | `""` |
| `logger.useFileLogger`              | Enable file logging | `""` |

### Configuration File Examples


Link: [YAML Example with detailed comments](https://github.com/Bazilio-san/fa-mcp-sdk/blob/master/cli-config.example.yaml)

The utility supports both **JSON** and **YAML** configuration formats.
Use either `.json`, `.yaml`, or `.yml` file extensions.

#### Usage:

```bash
# Interactive setup (will prompt for all parameters)
fa-mcp

# Using JSON configuration
fa-mcp config.json
fa-mcp --config=my-config.json

# Using YAML configuration (NEW!)
fa-mcp config.yaml
fa-mcp --config=my-config.yml
```



## Project Structure

```
my-mcp-server/
├── .claude/                     # Settings, Agents, Hooks for Claude Code
│   ├── agents/                  # Folder with Claude Code agents. Including the agent fa-mcp-sdk 
│   ├── hooks/                   # Code formatting hook after changes made by Claude Code
│   └── settings.json            # Claude Code settings
├── .run/                        # JetBrains IDE run configurations
├── config/                      # Environment configurations
│   ├── _local.yaml              # Local configuration template
│   ├── custom-environment-variables.yaml # Environment mapping
│   ├── default.yaml             # Base configuration
│   ├── development.yaml         # Development settings
│   ├── local.yaml               # Local configuration
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
├── FA-MCP-SDK-DOC/              # FA-MCP-SDK Documentation
├── scripts/                     # Utility scripts
│   ├── npm/                     # NPM utility scripts
│   ├── generate-jwt.js           # CLI JWT token generator
│   ├── kill-port.js             # Port cleanup utility
│   ├── pre-commit               # Git pre-commit hook
│   └── remove-nul.js            # File cleanup utility
├── src/                         # Source code
│   ├── _types_/                 # TypeScript type definitions
│   ├── api/                     # REST API routes
│   │   └── router.ts            # Express router
│   ├── asset/                   # Static assets
│   │   └── logo.svg             # Application logo/favicon
│   ├── prompts/                 # Agent prompts
│   │   ├── agent-brief.ts       # Agent brief
│   │   ├── agent-prompt.ts      # Main agent prompt
│   │   └── custom-prompts.ts    # Custom prompts
│   ├── tools/                   # MCP tool implementations
│   │   ├── handle-tool-call.ts  # Tool execution handler
│   │   └── tools.ts             # Tool definitions
│   ├── custom-resources.ts      # Custom MCP resources
│   └── start.ts                 # Application entry point
├── swagger/                     
│   └── openapi.yaml             # API description. Generated if none
├── tests/                       # Test suites
│   ├── mcp/                     # MCP protocol tests
│   ├── jest-simple-reporter.js  # Custom Jest reporter
│   └── utils.ts                 # Test utilities
├── .editorconfig                # Editor configuration
├── .env                         # Environment variables
├── .env.example                 # Environment variables template
├── .envrc                       # direnv configuration
├── .gitignore                   # Git ignore rules
├── eslint.config.js             # ESLint configuration
├── jest.config.js               # Jest test configuration
├── LICENSE                      # MIT license file
├── package.json                 # NPM package configuration
├── prompt-example-new-MCP.md    # Example of instructions for Claude Code for vibe coding of a custom MCP server 
├── README.md
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
| `npm run test:mcp` | Test MCP tools |
| `npm run test:mcp-http` | Test HTTP transport |
| `npm run test:mcp-sse` | Test SSE transport |
| `npm run test:mcp-stdio` | Test STDIO transport |
| `npm run generate-token` | Generate JWT tokens (Web UI) |
| `node scripts/generate-jwt.js` | Generate JWT token (CLI) |
| `/gen-jwt` | Generate JWT token (Claude Code skill) |
| `/upgrade-guide` | Generate upgrade guide for downstream projects (Claude Code skill) |
| `npm run consul:unreg` | Deregister from Consul |


## Server runs at
`http://localhost:3000` with:
- MCP endpoints at `/mcp/*`
- Admin panel for generating access tokens at `/admin`
  - When `adminAuth.type` includes `jwtToken`, the JWT **must** carry `allow: 'gen-token'`
    in its payload to be accepted. Tokens without this claim (e.g. the short-lived JWT
    auto-generated for the Agent Tester page) are rejected — this prevents them from
    being replayed to mint arbitrary long-lived tokens. `permanentServerTokens` and
    `basic` admin auth are unaffected.
    Generate an admin-capable JWT:
    `node scripts/generate-jwt.js -u admin -ttl 30d -p "allow=gen-token"`
- JWT generation API at `/gen-jwt` (when `webServer.genJwtApiEnable: true`)
- Swagger UI at `/docs`
- Health check at `/health`

## Agent Tester

Built-in chat interface for testing MCP server tools using an AI agent (OpenAI-compatible LLM).
The agent automatically discovers available tools and calls them in a conversational loop.

To enable, set environment variables (`.env` or shell):
```
AGENT_TESTER_ENABLED=true
AGENT_TESTER_OPENAI_API_KEY=sk-...
```

Or configure in `config/default.yaml` (or `local.yaml`):
```yaml
agentTester:
  enabled: true
  openAi:
    apiKey: sk-...
```

The tester UI is available at `http://localhost:<port>/agent-tester` and auto-connects to the local MCP server.
Supports custom LLM endpoints, configurable system prompts, and dynamic HTTP headers. Recommended model for testing: **gpt-5.2**.

## Upgrade Guide Skill

Claude Code skill that generates a step-by-step upgrade guide for projects built on fa-mcp-sdk.
Analyzes git diff between two versions/commits and produces an MD file covering config changes, template file updates, script changes, API changes, and dependency updates.

**Usage in Claude Code:**
```
/upgrade-guide 0.4.30 0.4.37
/upgrade-guide 0.4.30
/upgrade-guide abc1234
/upgrade-guide 0.4.30 0.4.37 на русском
```

Output language is English by default. Add a natural-language hint (e.g., "на русском", "in German") to change it.

Skill location: `.claude/skills/upgrade-guide/SKILL.md`

## Directory Requirements

- Use absolute paths for target directory
- **Empty directories only** - CLI aborts if files exist except for the following:

      .git/
      .idea/
      .vscode
      .DS_Store
      node_modules/
      dist/
      __misc/
      _tmp/
      .swp
      .swo
      .sublime-project
      .sublime-workspace
      ~last-cli-config.json

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

### Consul Registration
Set `consul.service.enable: true` and provide required tokens for automatic service registration.

### Nginx Configuration
Generated nginx configuration files in `deploy/NGINX/` for domain-based routing.

## License

MIT License
