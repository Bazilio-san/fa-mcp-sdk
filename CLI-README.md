# MCP Server Template Generator (`fa-mcp`)

A CLI utility that creates ready-to-use MCP (Model Context Protocol) server 
projects from the official template. The output is a fully configured project 
that can be immediately launched and developed.

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

The CLI will guide you through:
1. **Target Directory Selection** - Choose where to create your project
   - Answer `y` to create in current directory
   - Answer `n` to specify another path (absolute path required)
2. **Project Configuration** - Provide project details
3. **Advanced Settings** - Optional Consul and deployment configurations

#### Directory Selection
The utility will ask: "Create project in current directory?"
- Type `y` to create in the current directory
- Type `n` to specify a different absolute path

#### Parameter Configuration
**Required Parameters:**
- `project.name` - Project name (used in package.json)
- `project.description` - Project description
- `project.productName` - Display name for the project
- `port` - HTTP port for MCP server (default: 3000)

**Optional Parameters:**
Press Enter to skip any optional parameter:
- `author.name` - Author name (if not provided, author field will be removed from package.json)
- `author.email` - Author email (if not provided, will be removed from package.json)
- `git-base-url` - Git repository base URL (default: github.com/username)
- `consul.service.enable` - Consul registration on start
- `consul.envCode.prod/dev` - Environment codes
- `consul.agent.dev.dc/prd.dc` - Consul datacenters
- `mcp.domain` - Domain for nginx configuration
- `upstream` - Upstream server name

### Using Configuration File
```bash
fa-mcp config.json
```

Create a JSON configuration file to pre-configure parameters:

```json
{
  "project.name": "my-mcp-server",
  "project.description": "A custom MCP server",
  "project.productName": "My MCP Server",
  "author.name": "Your Name",
  "author.email": "your.email@example.com",
  "port": "3000",
  "git-base-url": "github.com/username",
  "consul.service.enable": "true"
}
```

## Configuration Parameters

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `project.name` | Project name (used in package.json) | `"my-mcp-server"` |
| `project.description` | Project description | `"A custom MCP server"` |
| `project.productName` | Display name for the project | `"My MCP Server"` |
| `author.name` | Author name | `"John Doe"` |
| `author.email` | Author email | `"john@example.com"` |
| `port` | HTTP port for MCP server | `"3000"` |
| `git-base-url` | Git repository base URL | `"github.com/username"` |

### Optional Parameters

| Parameter | Description                         | Default  |
|-----------|-------------------------------------|----------|
| `consul.service.enable` | Enable Consul registration on start | `"true"` |
| `consul.envCode.prod` | Production environment code         | -        |
| `consul.envCode.dev` | Development environment code        | -        |
| `consul.agent.dev.dc` | Consul datacenter for dev           | -        |
| `consul.agent.prd.dc` | Consul datacenter for prod          | -        |
| `mcp.domain` | Domain for nginx configuration      | -        |
| `upstream` | Upstream server name                | -        |

## Template Features

The generated MCP server includes:

- **🚀 Ready-to-Use MCP Server**: Complete implementation with HTTP transport
- **🔧 Development Tools**: TypeScript, ESLint, Jest testing
- **📚 API Documentation**: Swagger/OpenAPI documentation
- **⚙️ Configuration Management**: Environment-based config system
- **🔍 Logging**: Structured logging with configurable levels
- **🛡️ Security**: Rate limiting, CORS, Helmet protection
- **📊 Monitoring**: Health endpoints, Consul integration
- **🎯 Testing**: MCP protocol tests included

## Project Structure

```
my-mcp-server/
├── src/
│   ├── start.ts              # Application entry point
│   ├── tools/                # MCP tool implementations
│   ├── prompts/              # Agent prompts
│   ├── api/                  # REST API routes
│   └── custom-resources.ts   # Custom MCP resources
├── config/                   # Environment configurations
├── tests/                    # Test files
├── scripts/                  # Utility scripts
├── deploy/                   # Deployment configurations
└── dist/                     # Compiled JavaScript
```

## Getting Started

1. **Create Project**
   ```bash
   fa-mcp
   ```

2. **Navigate to Project**
   ```bash
   cd my-mcp-server
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Build Project**
   ```bash
   npm run build
   ```

5. **Start Development Server**
   ```bash
   npm start
   ```

The server will be available at `http://localhost:3000`

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the MCP server |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run dev` | Start with auto-recompilation |
| `npm test` | Run Jest tests |
| `npm run lint` | Run ESLint |
| `npm test:mcp` | Test MCP protocol functionality |
| `npm run generate-token` | Generate authentication tokens |

## MCP Integration

The generated server supports:
- **HTTP Transport**: RESTful API with SSE streaming
- **STDIO Transport**: Direct MCP protocol communication
- **Tools**: Custom function implementations
- **Resources**: File and data resource management
- **Prompts**: Agent prompt templates

## Development Workflow

1. **Add Tools**: Implement new tools in `src/tools/`
2. **Define Resources**: Add resources in `src/custom-resources.ts`
3. **Configure Prompts**: Modify prompts in `src/prompts/`
4. **API Endpoints**: Add REST endpoints in `src/api/`
5. **Testing**: Add tests in `tests/`

## Environment Configuration

The server uses environment-based configuration:
- `config/default.yaml` - Default settings
- `config/development.yaml` - Development overrides
- `config/production.yaml` - Production settings
- `config/test.yaml` - Test environment

## Deployment

### Production Deployment
```bash
# Build for production
npm run build

# Use PM2 for process management
pm2 start dist/src/start.js --name "my-mcp-server"
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
CMD ["node", "dist/src/start.js"]
```

## Contributing

To contribute to the MCP SDK or template:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Important Notes

- The utility ONLY works with empty directories - execution is aborted if directory contains any files
- Only `.git`, `.gitignore`, and `node_modules` are allowed in target directories
- All template parameters `{{param_name}}` are replaced with the entered values
- The `node_modules` folder from the template is not copied
- Created files are ready for immediate use

## Troubleshooting

**Directory not empty error**: Choose a completely empty directory or create a new one. The utility will not proceed if any files exist in the target directory.

**Directory access error**: Use absolute paths on Windows or run with administrator privileges.

**Invalid email**: Ensure the email contains the `@` symbol.

**Port already in use**: Choose a different free port during project configuration.

## Support

- **Documentation**: See the generated project's README.md
- **Issues**: Report bugs on GitHub
- **Community**: Join discussions in the MCP community

## License

MIT License - see LICENSE file for details.
