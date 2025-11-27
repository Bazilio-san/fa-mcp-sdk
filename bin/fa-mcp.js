#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRINT_FILLED = true;

const hl = (v) => chalk.bgGreen.black(v);
const hly = (v) => chalk.bgYellow.black(v);
const hp = (paramName) => ` [${chalk.magenta(paramName)}]`;
const formatDefaultValue = (v) => (v ? ` (default: ${hl(v)})` : '');
const OPTIONAL = chalk.gray(' (optional)');
const FROM_CONFIG = chalk.gray(' (from config)');
const trim = (s) => String(s || '').trim();

const printFilled = (paramName, paramValue) => {
  if (PRINT_FILLED) {
    console.log(`  ${hp(paramName)}: ${hl(paramValue)}`);
  }
};

const getAsk = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const yn_ = (prompt, defaultAnswer = 'y') => new Promise((resolve) => {
    rl.question(prompt, (v) => {
      resolve((trim(v) || defaultAnswer).toLowerCase());
    });
  });

  return {
    close: rl.close.bind(rl),

    question: (prompt) => new Promise(resolve => {
      rl.question(prompt, resolve);
    }),

    optional: (title, paramName, defaultValue, example = undefined) => new Promise(resolve => {
      const defaultText = formatDefaultValue(defaultValue);
      example = example ? ` (example: ${example})` : '';
      const prompt = `${title}${hp(paramName)}${defaultText}${example}${OPTIONAL}: `;
      rl.question(prompt, (v) => {
        resolve(trim(v) || trim(defaultValue));
      });
    }),

    yn: async (title, paramName, defaultValue = 'false') => {
      const isTrue = /^(true|y)$/i.test(trim(defaultValue));
      const y = isTrue ? `${hl('y')}` : 'y';
      const n = isTrue ? 'n' : `${hl('n')}`;

      const hpn = paramName ? hp(paramName) : '';
      const prompt = `${title}${hpn} (${y}/${n}): `;
      while (true) {
        const answer = await yn_(prompt, defaultValue === 'true' ? 'y' : 'n');
        if (answer === 'y' || answer === 'n') {
          return answer === 'y';
        }
        console.log(chalk.red('⚠️  Please enter "y" for yes or "n" for no.'));
      }
    },
  };
};

class MCPGenerator {
  constructor () {
    this.templateDir = path.join(__dirname, '..', 'cli-template');
    this.lastConfigPath = path.join(process.cwd(), '~last-cli-config.json');
    this.requiredParams = [
      {
        name: 'project.name',
        defaultValue: '',
        title: 'Project name for package.json and MCP server identification',
      },
      {
        name: 'project.description',
        defaultValue: '',
        title: 'Project description for package.json',
      },
      {
        name: 'project.productName',
        defaultValue: '',
        title: 'Product name displayed in UI and documentation',
      },
      {
        name: 'port',
        defaultValue: '3000',
        title: 'Web server port for HTTP endpoints and MCP protocol',
      },
    ];

    this.optionalParams = [
      {
        name: 'author.name',
        defaultValue: '',
        title: 'Author name for package.json',
      },
      {
        name: 'author.email',
        defaultValue: '',
        title: 'Author email for package.json',
      },

      {
        name: 'git-base-url',
        defaultValue: 'github.com/username',
        title: 'Git repository base URL',
      },
      {
        name: 'consul.agent.dev.dc',
        defaultValue: '',
        title: 'Development Consul Datacenter to search for services',
      },
      {
        name: 'consul.agent.dev.host',
        defaultValue: 'consul.my.ui',
        title: 'Development Consul UI host',
      },
      {
        name: 'consul.agent.dev.token',
        defaultValue: '***',
        title: 'Token for accessing Development Consul Datacenter',
      },
      {
        name: 'consul.agent.prd.dc',
        defaultValue: '',
        title: 'Production Consul Datacenter to search for services',
      },
      {
        name: 'consul.agent.prd.host',
        defaultValue: 'consul.my.ui',
        title: 'Production Consul UI host',
      },
      {
        name: 'consul.agent.prd.token',
        defaultValue: '***',
        title: 'Token for accessing Production Consul Datacenter',
      },
      // Register in Consul
      {
        name: 'consul.service.enable',
        defaultValue: 'false',
        title: 'Whether to register service in Consul',
      },
      {
        name: 'consul.agent.reg.token',
        defaultValue: '***',
        title: 'Token for registering service with Consul agent',
      },
      {
        name: 'consul.envCode.dev',
        defaultValue: '<envCode.dev>',
        title: 'Development environment code for Consul service ID generation',
      },
      {
        name: 'consul.envCode.prod',
        defaultValue: '<envCode.prod>',
        title: 'Production environment code for Consul service ID generation',
      },

      {
        name: 'mcp.domain',
        defaultValue: '',
        title: 'Domain name for nginx configuration',
      },
      {
        name: 'ssl-wildcard.conf.rel.path',
        defaultValue: 'snippets/ssl-wildcard.conf',
        title: `The relative path to the nginx configuration file 
in the /etc/nginx folder that specifies the SSL 
certificate's public and private keys`,
      },

      {
        name: 'webServer.auth.enabled',
        defaultValue: 'false',
        title: 'Whether to enable authorization by token in the MCP server',
      },
      {
        skip: true,
        name: 'webServer.auth.token.encryptKey',
        defaultValue: '***',
        title: 'Encryption key for MCP tokens',
      },
      {
        name: 'webServer.auth.token.checkMCPName',
        defaultValue: 'false',
        title: 'Whether to check MCP name in the token',
      },
      {
        skip: true,
        name: 'projectAbsPath',
      },
      {
        title: 'Is it Production mode',
        name: 'isProduction',
      },
      {
        skip: true,
        name: 'NODE_ENV',
      },
      {
        name: 'SERVICE_INSTANCE',
        defaultValue: '',
        title: 'Suffix of the service name in Consul and process manager',
      },
      {
        skip: true,
        name: 'PM2_NAMESPACE',
      },
      {
        name: 'maintainerUrl',
        defaultValue: '',
        title: 'Maintainer url',
      },
      {
        name: 'logger.useFileLogger',
        defaultValue: '',
        title: 'Whether to check MCP name in the token',
      },
      {
        skip: true,
        name: 'logger.dir',
        defaultValue: '',
        title: 'Absolute path to the folder where logs will be written',
      },
    ];
  }

  createConfigProxy (config) {
    const lastConfigPath = this.lastConfigPath; // Capture this in closure

    return new Proxy(config, {
      set (target, prop, value, receiver) {
        // Check if the value is actually changing
        const currentValue = target[prop];
        if (currentValue === value) {
          return Reflect.set(target, prop, value, receiver);
        }
        // Regular assignment behavior first
        const result = Reflect.set(target, prop, value, receiver);
        // Save to file asynchronously without blocking
        fs.writeFile(lastConfigPath, JSON.stringify(target, null, 2), 'utf8')
          .catch(error => console.warn('⚠️  Warning: Could not save config to file:', error.message));
        return result;
      },
    });
  }

  async collectConfigData (config, isRetry = false) {
    const ask = getAsk();

    // Collect required parameters
    for (const param of this.requiredParams) {
      const { title, name } = param;
      const currentValue = config[name];
      const defaultValue = currentValue || param.defaultValue;

      // Skip if already has value and not in retry mode
      if (currentValue && !isRetry) {
        printFilled(name, currentValue);
        continue;
      }

      let value;
      const defaultText = formatDefaultValue(defaultValue);

      // Keep asking until we get a valid value for required parameters
      while (true) {
        switch (name) {
          case 'port':
            value = await ask.question(`Enter port${defaultText}: `);
            value = value || defaultValue;
            break;
          default:
            value = await ask.question(`Enter ${title} [${name}]${defaultText}: `);
            value = value.trim() || defaultValue;
        }

        // Check if we have a valid value
        if (value && value.trim()) {
          break; // Exit the loop - we have a valid value
        }

        // If no default value and no input, continue asking
        if (!defaultValue) {
          console.error(chalk.red(`⚠️  ${name} is required. Please enter a value.`));
          continue;
        }

        // Should not reach here, but just in case
        break;
      }

      config[name] = value;
    }

    // Self register service in consul
    {
      const param = this.optionalParams.find((p) => p.name === 'consul.service.enable');
      const { title, name } = param;
      const currentValue = config[name];
      const defaultValue = currentValue || param.defaultValue;
      let shouldSkipConsulRegisterParams = currentValue === 'false';

      if (currentValue && !isRetry) {
        printFilled(name, currentValue);
      } else {
        const enabled = await ask.yn(title, name, defaultValue);
        config[name] = String(enabled);
        shouldSkipConsulRegisterParams = !enabled;
      }

      // If consul registration is enabled, collect consul parameters immediately
      if (!shouldSkipConsulRegisterParams) {
        const consulParams = this.optionalParams.filter(({ name: n }) => n === 'consul.agent.reg.token' || n.startsWith('consul.envCode.'));
        for (const param of consulParams) {
          const { title, name } = param;
          const currentValue = config[name];
          const defaultValue = currentValue || param.defaultValue;

          // Skip if already has value and not in retry mode
          if (currentValue && !isRetry) {
            printFilled(name, currentValue);
            continue;
          }

          const value = await ask.question(`${title} [${name}]${formatDefaultValue(defaultValue)}${OPTIONAL}: `);
          config[name] = trim(value) || defaultValue;
        }
      }
    }
    // Other consul parameters
    const consulParams = this.optionalParams.filter(({ name: n }) => n.startsWith('consul.agent.dev') || n.startsWith('consul.agent.prd'));
    for (const param of consulParams) {
      const { title, name } = param;
      const currentValue = config[name];
      if (currentValue && !isRetry) {
        printFilled(name, currentValue);
        continue;
      }
      const defaultValue = currentValue || param.defaultValue;
      config[name] = await ask.optional(title, name, defaultValue);
    }

    // Handle webServer.auth.enabled to determine if auth parameters are needed
    {
      const param = this.optionalParams.find((p) => p.name === 'webServer.auth.enabled');
      const { title, name } = param;
      const currentValue = config[name];
      let shouldSkipAuthParams = currentValue === 'false';

      if (currentValue && !isRetry) {
        printFilled(name, currentValue);
      } else {
        const enabled = await ask.yn(title, name, currentValue || param.defaultValue);
        config[name] = String(enabled);
        shouldSkipAuthParams = !enabled;
      }

      // Generate encrypt key if auth is enabled
      if (!shouldSkipAuthParams) {
        config['webServer.auth.token.encryptKey'] = uuidv4();
      }

      // If authentication is enabled, collect auth parameters immediately
      if (!shouldSkipAuthParams) {
        const authParams = this.optionalParams.filter((p) => p.name.startsWith('webServer.auth.') && p.name !== 'webServer.auth.enabled');

        for (const param of authParams) {
          const { title, name, skip } = param;
          const currentValue = config[name];
          const defaultValue = currentValue || param.defaultValue;

          // Skip if already has value and not in retry mode
          if (currentValue && !isRetry) {
            printFilled(name, currentValue);
            continue;
          }
          if (skip) {
            if (name === 'webServer.auth.token.encryptKey') {
              config[name] = uuidv4();
            }
            continue;
          }
          switch (name) {
            case 'webServer.auth.token.checkMCPName':
              config[name] = String(await ask.yn(title, name, defaultValue));
              break;
            default:
              config[name] = await ask.optional(title, name, defaultValue);
          }
        }
      }
    }

    // Collect optional parameters
    for (const param of this.optionalParams) {
      const { title, name, skip } = param;
      // Skip already processed parameters
      if (name.startsWith('consul.') || name.startsWith('webServer.auth.')) {
        continue;
      }

      const currentValue = config[name];
      const defaultValue = currentValue || param.defaultValue;

      // Skip if already has value and not in retry mode
      if (currentValue && !isRetry) {
        printFilled(name, currentValue);

        if (name === 'mcp.domain' && !config['upstream']) {
          config['upstream'] = currentValue.replace(/\./g, '-');
        }

        continue;
      }
      if (skip) {
        continue;
      }
      let value;
      switch (name) {
        case 'git-base-url':
          value = await ask.optional(title, name, defaultValue, 'github.com/username OR gitlab.company.com/PROJECT');
          value = value.trim() || defaultValue;
          break;
        case 'author.email': {
          let go = true;
          while (go) {
            value = await ask.optional(title, name, defaultValue);
            if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/im.test(value)) {
              go = false;
            } else {
              console.log(chalk.red('⚠️  Please enter valid email or leave empty.'));
            }
          }
          break;
        }

        case 'mcp.domain':
          value = await ask.optional(title, name, defaultValue);
          if (value) {
            // Auto-generate upstream from mcp.domain by replacing dots with dashes
            config.upstream = value.replace(/\./g, '-');
          }
          continue;

        case 'maintainerUrl':
          value = await ask.optional(title, name, defaultValue);
          if (value) {
            config.maintainerHtml = `<a href="${value}" target="_blank" rel="noopener" class="clickable">Support</a>`;
          }
          continue;
        case 'logger.useFileLogger':
          const enabled = await ask.yn(title, name, defaultValue);
          config[name] = String(enabled);
          if (enabled) {
            const nm = 'logger.dir';
            const p = this.optionalParams.find(({ name: n }) => n === nm);
            value = await ask.optional(p.title, nm, config[nm] || p.defaultValue);
            if (value) {
              config[nm] = value;
            }
          } else {
            config[nm] = '';
          }
          continue;
        default:
          value = await ask.optional(title, name, defaultValue);
      }

      if (value) {
        config[name] = value;
      }
    }
    ask.close();
  }

  async confirmConfiguration (config) {
    console.log('\n📋 Configuration Summary:');
    console.log('========================');

    // Show all parameters
    const allParams = [...this.requiredParams, ...this.optionalParams];
    for (const param of allParams) {
      const value = config[param.name];
      if (value !== undefined) {
        console.log(`   ${param.name}: ${hl(value)}`);
      }
    }

    const ask = getAsk();
    let confirmed;
    const use = config.forceAcceptConfig;
    // Check for automatic answer from config
    if (use === 'y' || use === 'n') {
      confirmed = use === 'y';
      console.log(`\nUse this configuration: ${hl('y')}es${FROM_CONFIG}`);
    } else {
      confirmed = await ask.yn('\nUse this configuration?', '', 'y');
    }
    if (confirmed) {
      config.forceAcceptConfig = 'y';
    } else {
      delete config.forceAcceptConfig;
    }
    ask.close();

    return confirmed;
  }

  async collectConfiguration () {
    const config = {};
    const configFile = process.argv.find((arg) => arg.endsWith('.json')) ||
      process.argv.find((arg) => arg.startsWith('--config='))?.split('=')[1];

    if (configFile) {
      try {
        const configData = await fs.readFile(configFile, 'utf8');
        const parsedConfig = JSON.parse(configData);
        Object.assign(config, parsedConfig);
        console.log(`📋 Loaded configuration from: ${hly(configFile)}`);
      } catch (error) {
        console.warn(`⚠️  Warning: Could not load config file ${configFile}`);
      }
    }

    // Create proxy for automatic saving before starting data collection
    const configProxy = this.createConfigProxy(config);

    // Save initial state if there's any pre-loaded config
    if (Object.keys(config).length > 0) {
      try {
        await fs.writeFile(this.lastConfigPath, JSON.stringify(config, null, 2), 'utf8');
      } catch (error) {
        console.warn('⚠️  Warning: Could not save initial config to file:', error.message);
      }
    }

    let confirmed = false;
    let isRetry = false;

    // Loop until configuration is confirmed
    while (!confirmed) {
      await this.collectConfigData(configProxy, isRetry);

      // Set NODE_ENV and PM2_NAMESPACE based on isProduction
      config.NODE_ENV = config.isProduction === 'true' ? 'production' : 'development';
      config.PM2_NAMESPACE = config.isProduction === 'true' ? 'prod' : 'dev';

      confirmed = await this.confirmConfiguration(config);

      if (!confirmed) {
        console.log('\n🔄 Let\'s re-enter the configuration:\n');
        isRetry = true;
      }
    }

    return config;
  }

  async getTargetPath (config = {}) {
    const ask = getAsk();

    let targetPath = process.cwd();
    let createInCurrent;
    let pPath = trim(config.projectAbsPath);
    if (pPath) {
      targetPath = path.resolve(pPath);
      console.log(`Create project in: ${hl(targetPath)}${FROM_CONFIG}`);
    } else {
      createInCurrent = await ask.yn(`Create project in current directory? (${hl(targetPath)})`, '', 'n');
      if (!createInCurrent) {
        targetPath = await ask.question('Enter absolute path for project: ');
        targetPath = path.resolve(targetPath);
      }
    }

    config.projectAbsPath = targetPath;
    // Create directory if it doesn't exist
    try {
      await fs.access(targetPath);
    } catch {
      console.log('Creating directory recursively...');
      await fs.mkdir(targetPath, { recursive: true });
    }

    const errMsg = `❌  Directory ${hl(targetPath)} not empty - cannot create project here. Use an empty directory or specify a different path.`;

    // Check if directory is empty
    try {
      const files = await fs.readdir(targetPath);
      const allowedFiles = ['.git', '.idea', '.vscode', '.swp', '.swo', '.DS_Store', '.sublime-project', '.sublime-workspace', 'node_modules', 'dist'];
      const hasOtherFiles = files.some(file => !allowedFiles.includes(file));

      if (hasOtherFiles) {
        console.error(errMsg);
        process.exit(1);
      }
    } catch (error) {
      if (error.message.includes('Directory not empty')) {
        console.error(errMsg);
        process.exit(1);
      }
      throw new Error(`Cannot access directory: ${error.message}`);
    }

    ask.close();
    return targetPath;
  }

  async copyDirectory (source, target) {
    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue; // Skip node_modules & dist directories
      }

      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true });
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }

  async handlePackageJson (content, config) {
    try {
      // First replace all template parameters in the content string
      let updatedContent = content;
      for (const [param, value] of Object.entries(config)) {
        const template = `{{${param}}}`;
        if (updatedContent.includes(template)) {
          updatedContent = updatedContent.replace(new RegExp(escapeRegExp(template), 'g'), value);
        }
      }

      // Now parse the updated content and handle author fields
      const packageJson = JSON.parse(updatedContent);
      const authorName = config['author.name'];
      const authorEmail = config['author.email'];
      // Handle optional author fields
      if (!authorName && !authorEmail) {
        delete packageJson.author;
      } else {
        if (!packageJson.author) {packageJson.author = {};}
        if (authorName) {
          packageJson.author.name = authorName;
        }
        if (authorEmail) {
          packageJson.author.email = authorEmail;
        }
        // Remove empty author object if no fields
        if (Object.keys(packageJson.author).length === 0) {
          delete packageJson.author;
        }
      }

      return JSON.stringify(packageJson, null, 2);
    } catch (error) {
      throw new Error(`Error processing package.json: ${error.message}`);
    }
  }

  async getAllFiles (dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...await this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  async replaceTemplateParameters (targetPath, config) {
    const files = await this.getAllFiles(targetPath);

    for (const filePath of files) {
      let content = await fs.readFile(filePath, 'utf8');
      let modified = false;

      // Special handling for package.json
      if (filePath.endsWith('package.json')) {
        content = await this.handlePackageJson(content, config);
        modified = true;
      } else {
        // Replace all template parameters
        for (const [param, value] of Object.entries(config)) {
          const template = `{{${param}}}`;
          if (content.includes(template)) {
            content = content.replace(new RegExp(escapeRegExp(template), 'g'), value);
            modified = true;
          }
        }
      }

      if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
      }
    }
  }

  async createProject (targetPath, config) {
    // Copy template files
    await this.copyDirectory(this.templateDir, targetPath);
    await fs.copyFile(path.join(targetPath, '.env.example'), path.join(targetPath, '.env')); // VVT

    // Rename mcp-template.com.conf if mcp.domain is provided
    const mcpDomain = config['mcp.domain'];
    if (mcpDomain) {
      try {
        const oldConfigPath = path.join(targetPath, 'deploy', 'mcp-template.com.conf');
        const newConfigPath = path.join(targetPath, 'deploy', `${mcpDomain}.conf`);

        await fs.access(oldConfigPath);
        await fs.rename(oldConfigPath, newConfigPath);
      } catch (error) {
        // File doesn't exist or rename failed, which is not critical
        console.log('⚠️  Warning: Could not rename mcp-template.com.conf file', error);
      }
    }

    // Read _local.yaml into memory and rename it to local.yaml
    let localYamlContent = '';
    try {
      const localYamlPath = path.join(targetPath, 'config', '_local.yaml');
      const localYamlNewPath = path.join(targetPath, 'config', 'local.yaml');

      localYamlContent = await fs.readFile(localYamlPath, 'utf8');
      await fs.rename(localYamlPath, localYamlNewPath);
    } catch (error) {
      // _local.yaml doesn't exist, which might be fine
      console.log('⚠️  Warning: Could not process config/_local.yaml file:', error.message);
    }

    // Replace template parameters
    await this.replaceTemplateParameters(targetPath, config);

    // Replace template placeholders with defaultValue from optionalParams and save as _local.yaml
    if (localYamlContent) {
      try {
        let modifiedContent = localYamlContent;

        // Replace with defaultValue from optionalParams
        for (const param of this.optionalParams) {
          const template = `{{${param.name}}}`;
          if (modifiedContent.includes(template)) {
            const defaultValue = param.defaultValue || '';
            modifiedContent = modifiedContent.replace(new RegExp(escapeRegExp(template), 'g'), defaultValue);
          }
        }
        // Replacement of the remaining substitution places with what is in the config
        for (const [paramName, value] of Object.entries(config)) {
          const template = `{{${paramName}}}`;
          if (modifiedContent.includes(template)) {
            modifiedContent = modifiedContent.replace(new RegExp(escapeRegExp(template), 'g'), value);
          }
        }

        const newLocalYamlPath = path.join(targetPath, 'config', '_local.yaml');
        await fs.writeFile(newLocalYamlPath, modifiedContent, 'utf8');
      } catch (error) {
        console.log('⚠️  Warning: Could not create config/_local.yaml file:', error.message);
      }
    }

    // Remove node_modules from project if it exists
    try {
      const nodeModulesPath = path.join(targetPath, 'node_modules');
      await fs.access(nodeModulesPath);
      await fs.rm(nodeModulesPath, { recursive: true, force: true });
    } catch {
      // node_modules doesn't exist, which is fine
    }
  }

  async run () {
    console.log('MCP Server Template Generator');
    console.log('==================================\n');

    try {
      const config = await this.collectConfiguration();
      const targetPath = await this.getTargetPath(config);

      console.log(`\n📁 Creating project in: ${targetPath}`);
      await this.createProject(targetPath, config);

      console.log('\n✅  MCP Server template created successfully!');
      console.log('\n📋 Next steps:');
      console.log(`   cd ${targetPath}`);
      console.log('   npm install');
      console.log('   npm run build');
      console.log('   npm start');

      process.exit(0);

    } catch (error) {
      console.error('\n❌  Error:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

function escapeRegExp (string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Run the generator
const generator = new MCPGenerator();
generator.run().catch(console.error);
