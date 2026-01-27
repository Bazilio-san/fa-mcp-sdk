#!/usr/bin/env node

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRINT_FILLED = true;
const PROJ_ROOT = path.join(__dirname, '..');

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

const pjContent = fss.readFileSync(path.join(PROJ_ROOT, 'package.json'));

const faMcpSdkVersion = JSON.parse(pjContent).version;

// Print version and exit on -V or --version
const argv = process.argv.slice(2);
if (argv.includes('-V') || argv.includes('--version')) {
  console.log(faMcpSdkVersion);
  process.exit(0);
}

const ALLOWED_FILES = [
  '.git',
  '.idea',
  '.vscode',
  '.swp',
  '.swo',
  '.DS_Store',
  '.sublime-project',
  '.sublime-workspace',
  'node_modules',
  'dist',
  '__misc',
  '_tmp',
  '~last-cli-config.json',
  'yarn.lock',
];

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

/**
 * Parse configuration file (JSON or YAML)
 * @param {string} filePath - Path to the configuration file
 * @param {string} content - Content of the file
 * @returns {object} Parsed configuration object
 */
const parseConfigFile = (filePath, content) => {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.json') {
      return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      return yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
    } else {
      // Try to detect format by content
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return JSON.parse(content);
      } else {
        return yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse configuration file ${filePath}: ${error.message}`);
  }
};

const removeIfExists = async (targetPath, relPath, options = {}) => {
  const fullPath = path.join(targetPath, relPath);

  try {
    let finalOptions = { force: true, ...options };

    try {
      const stat = await fs.lstat(fullPath);
      if (stat.isDirectory() && finalOptions.recursive === undefined) {
        finalOptions = { ...finalOptions, recursive: true };
      }
    } catch {
      // lstat will crash if there is no file/folder – that's ok, just go to rm with the same options
    }

    await fs.rm(fullPath, finalOptions);
  } catch {
    // ignore any deletion errors
  }
};

class MCPGenerator {
  constructor () {
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
        name: 'consul.agent.reg.host',
        defaultValue: '',
        title: 'The host of the consul agent where the service will be registered',
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
        name: 'NODE_CONSUL_ENV',
        defaultValue: '',
        title: 'Affects how the Consul service ID is formed - as a product or development ID. Valid values: "" | "development" | "production"',
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
        defaultValue: 'false',
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
        title: 'Whether to use file logger',
      },
      {
        skip: true,
        name: 'logger.dir',
        defaultValue: '',
        title: 'Absolute path to the folder where logs will be written',
      },
      {
        name: 'claude.isBypassPermissions',
        defaultValue: 'false',
        title: 'Enable GOD Mode for Claude Code',
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
        case 'logger.useFileLogger': {
          const enabled = await ask.yn(title, name, defaultValue);
          config[name] = String(enabled);
          const nm = 'logger.dir';
          if (enabled) {
            const p = this.optionalParams.find(({ name: n }) => n === nm);
            value = await ask.optional(p.title, nm, config[nm] || p.defaultValue);
            if (value) {
              config[nm] = value;
            }
          } else {
            config[nm] = '';
          }
          continue;
        }
        case 'isProduction':
        case 'claude.isBypassPermissions': {
          const enabled = await ask.yn(title, name, defaultValue);
          config[name] = String(enabled);
          continue;
        }
        case 'NODE_CONSUL_ENV': {
          if (currentValue === '') {
            continue;
          }
          value = await ask.optional(title, name, defaultValue);
          if (value === '' || value === 'development' || value === 'production') {
            config[name] = value;
          } else {
            config[name] = '';
          }
          continue;
        }

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
    const configFile = process.argv.find((arg) => arg.endsWith('.json') || arg.endsWith('.yaml') || arg.endsWith('.yml')) ||
      process.argv.find((arg) => arg.startsWith('--config='))?.split('=')[1];

    if (configFile) {
      try {
        const configData = await fs.readFile(configFile, 'utf8');
        const parsedConfig = parseConfigFile(configFile, configData);
        Object.assign(config, parsedConfig);
        console.log(`📋 Loaded configuration from: ${hly(configFile)}`);
      } catch (error) {
        console.warn(`⚠️  Warning: Could not load config file ${configFile}: ${error.message}`);
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

    if (configProxy.NODE_ENV === 'development') {
      configProxy.isProduction = 'false';
    } else if (configProxy.NODE_ENV === 'production') {
      configProxy.isProduction = 'true';
    }
    if (config['logger.useFileLogger'] !== 'true') {
      config['logger.dir'] = '';
    }
    let confirmed = false;
    let isRetry = false;

    // Loop until configuration is confirmed
    while (!confirmed) {
      await this.collectConfigData(configProxy, isRetry);

      // Set NODE_ENV and PM2_NAMESPACE based on isProduction
      config.NODE_ENV = config.isProduction === 'true' ? 'production' : 'development';
      config.PM2_NAMESPACE = config.isProduction === 'true' ? 'prod' : 'dev';
      config.SERVICE_INSTANCE = config.PM2_NAMESPACE;

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

    let tp = process.cwd();
    let createInCurrent;
    let pPath = trim(config.projectAbsPath);
    if (pPath) {
      tp = path.resolve(pPath);
      console.log(`Create project in: ${hl(tp)}${FROM_CONFIG}`);
    } else {
      createInCurrent = await ask.yn(`Create project in current directory? (${hl(tp)})`, '', 'n');
      if (!createInCurrent) {
        tp = await ask.question('Enter absolute path for project: ');
        tp = path.resolve(tp);
      }
    }

    config.projectAbsPath = tp;
    // Create directory if it doesn't exist
    try {
      await fs.access(tp);
    } catch {
      console.log('Creating directory recursively...');
      await fs.mkdir(tp, { recursive: true });
    }

    const errMsg = `❌  Directory ${hl(tp)} not empty - cannot create project here. Use an empty directory or specify a different path.`;

    // Check if directory is empty
    try {
      const files = await fs.readdir(tp);
      const firstDeprecatedFile = files.find((file) => !ALLOWED_FILES.includes(file));

      if (firstDeprecatedFile) {
        console.error(errMsg);
        console.error(`    First deprecated file: ${hl(firstDeprecatedFile)}`);
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
    return tp;
  }

  async copyDirectory (source, target) {
    const entries = await fs.readdir(source, { withFileTypes: true });
    if (!fss.existsSync(target)) {
      await fs.mkdir(target, { recursive: true });
    }

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
      content = content
        .replace(/"project\.name"/g, '"{{project.name}}"')
        .replace(/"node \.\.\/scripts/g, '"node ./scripts');
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

      packageJson.dependencies['fa-mcp-sdk'] = `^${faMcpSdkVersion}`;

      if (!config.keepPostinstall) {
        delete packageJson.scripts.postinstall;
      }

      return JSON.stringify(packageJson, null, 2);
    } catch (error) {
      throw new Error(`Error processing package.json: ${error.message}`);
    }
  }

  async getAllFiles (dir, skipRootDirs) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (skipRootDirs && skipRootDirs.includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...await this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  async transformTargetFile (config, targetRelPath, transformFn) {
    const targetPath = config.projectAbsPath;
    const targetFullPath = path.join(targetPath, targetRelPath);
    const content = await fs.readFile(targetFullPath, 'utf8');
    const transformedContent = transformFn(content, config);
    await fs.writeFile(targetFullPath, transformedContent, 'utf8');
  }

  async replaceTemplateParameters (config) {
    const targetPath = config.projectAbsPath;
    const files = await this.getAllFiles(targetPath, ALLOWED_FILES);
    const importRe = /'[^']+\/core\/index.js'/ig;
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
        if (importRe.test(content)) {
          content = content.replace(importRe, '\'fa-mcp-sdk\'');
          modified = true;
        }
      }
      if (filePath.endsWith('test-sse-npm-package.js')) {
        content = content.replace(/http:\/\/localhost:9876/g, `http://localhost:${config.port}`);
        modified = true;
      }
      if (filePath.endsWith('test-stdio.js')) {
        content = content.replace('../dist/template/start.js', 'dist/src/start.js');
        modified = true;
      }

      if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
      }
    }
    if (config['NODE_CONSUL_ENV'] === '') {
      await this.transformTargetFile(config, '.env', (c) => c.replace(/^(NODE_CONSUL_ENV)=([^\r\n]*)/m, '#$1=$2'));
    }
    if (config['claude.isBypassPermissions'] === 'true') {
      const c1 = ['sudo cp', 'sudo', 'bash', 'chmod', 'curl', 'dir', 'echo', 'git', 'find', 'grep', 'jest',
        'mkdir', 'node', 'npm install', 'npm run', 'npm test', 'npm', 'npx', 'pkill', 'set', 'playwright', 'powershell',
        'rm', 'taskkill', 'tasklist', 'timeout', 'turbo run', 'wc'];
      const c2 = ['jobs', 'npm start', 'unset http_proxy'];
      const i = ' '.repeat(8);
      const allowBashLines = [...c1.map((c) => `${i}"Bash(${c}:*)",`), ...c2.map((c) => `${i}"Bash(${c})",`)].join('\n');
      const transformFn = (c) => c.replace('"acceptEdits"', '"bypassPermissions"')
        .replace(/"allow": \[\s+"Edit",/, `"allow": [\n${allowBashLines}\n${i}"Edit",`);
      await this.transformTargetFile(config, '.claude/settings.json', transformFn);
    }
  }

  async createProject (config) {
    const targetPath = config.projectAbsPath;
    // Copy template files
    await this.copyDirectory(path.join(PROJ_ROOT, 'cli-template'), targetPath);
    await this.copyDirectory(path.join(PROJ_ROOT, 'src/template'), path.join(targetPath, 'src'));

    const testsTargetPath = path.join(targetPath, 'tests');

    await this.copyDirectory(path.join(PROJ_ROOT, 'src/tests'), testsTargetPath);
    await fs.copyFile(path.join(targetPath, '.env.example'), path.join(targetPath, '.env'));
    await fs.rename(path.join(targetPath, 'gitignore'), path.join(targetPath, '.gitignore'));
    await fs.rename(path.join(targetPath, 'r'), path.join(targetPath, '.run'));

    await this.copyDirectory(path.join(PROJ_ROOT, 'config'), path.join(targetPath, 'config'));

    const scriptsTargetPath = path.join(targetPath, 'scripts');
    await this.copyDirectory(path.join(PROJ_ROOT, 'scripts'), scriptsTargetPath);
    await fs.rm(path.join(targetPath, 'scripts/copy-static.js'), { force: true });
    await fs.rm(path.join(targetPath, 'scripts/publish.sh'), { force: true });

    // Rename all .xml files in .run directory to .run.xml
    const runDirPath = path.join(targetPath, '.run');
    const files = await fs.readdir(runDirPath);

    for (const file of files) {
      if (file.endsWith('.xml')) {
        const oldFilePath = path.join(runDirPath, file);
        const newFileName = file.slice(0, -4) + '.run.xml';
        const newFilePath = path.join(runDirPath, newFileName);
        await fs.rename(oldFilePath, newFilePath);
      }
    }

    // Rename mcp-template.com.conf if mcp.domain is provided
    const mcpDomain = config['mcp.domain'];
    if (mcpDomain) {
      try {
        const oldConfigPath = path.join(targetPath, 'deploy/NGINX/sites-enabled/mcp-template.com.conf');
        const newConfigPath = path.join(targetPath, 'deploy/NGINX/sites-enabled', `${mcpDomain}.conf`);

        await fs.access(oldConfigPath);
        await fs.rename(oldConfigPath, newConfigPath);
      } catch (error) {
        // File doesn't exist or rename failed, which is not critical
        console.log('⚠️  Warning: Could not rename mcp-template.com.conf file', error);
      }
    }

    // Read _local.yaml into memory and rename it to local.yaml
    let localYamlExampleContent = '';
    const localYamlExamplePath = path.join(targetPath, 'config', '_local.yaml');
    const localYamlPath = path.join(targetPath, 'config', 'local.yaml');
    try {

      localYamlExampleContent = await fs.readFile(localYamlExamplePath, 'utf8');
    } catch (error) {
      console.log('⚠️  Warning: Could not process config/_local.yaml file:', error.message);
    }

    // Replace template parameters
    await this.replaceTemplateParameters(config);

    // Replace template placeholders with defaultValue from optionalParams and save as _local.yaml
    if (localYamlExampleContent) {
      try {
        let localYamlExampleModifiedContent = localYamlExampleContent;
        let localYamlModifiedContent = localYamlExampleContent;
        // Replace with defaultValue from optionalParams
        for (const param of this.optionalParams) {
          const template = `{{${param.name}}}`;
          if (localYamlExampleModifiedContent.includes(template)) {
            const defaultValue = param.defaultValue || '';
            localYamlExampleModifiedContent = localYamlExampleModifiedContent.replace(new RegExp(escapeRegExp(template), 'g'), defaultValue);
          }
        }

        // Replacement of the remaining substitution places with what is in the config
        for (const [paramName, value] of Object.entries(config)) {
          const template = `{{${paramName}}}`;
          if (localYamlExampleModifiedContent.includes(template)) {
            localYamlExampleModifiedContent = localYamlExampleModifiedContent.replace(new RegExp(escapeRegExp(template), 'g'), value);
          }
          if (localYamlModifiedContent.includes(template)) {
            localYamlModifiedContent = localYamlModifiedContent.replace(new RegExp(escapeRegExp(template), 'g'), value);
          }
        }
        if (!config['consul.agent.reg.host']) {
          localYamlModifiedContent = localYamlModifiedContent.replace(/(\n +)host: '[^']*'( # The host of the consul agent)/, '$1# host: \'\'$2');
        }

        await fs.writeFile(localYamlPath, localYamlModifiedContent, 'utf8');
        await fs.writeFile(localYamlExamplePath, localYamlExampleModifiedContent, 'utf8');
      } catch (error) {
        console.log('⚠️  Warning: Could not create config/_local.yaml file:', error.message);
      }
    }
    const pathsToRemove = [
      { rel: 'package-lock.json' },
    ];

    await Promise.all(
      pathsToRemove.map(({ rel, options }) => removeIfExists(targetPath, rel, options)),
    );
  }

  async run () {
    console.log('MCP Server Template Generator');
    console.log('==================================\n');

    try {
      const config = await this.collectConfiguration();
      const targetPath = await this.getTargetPath(config);

      console.log(`\n📁 Creating project in: ${targetPath}`);
      await this.createProject(config);

      console.log('\n✅  MCP Server template created successfully!');
      console.log('\n📋 Next steps:');
      console.log(`   cd ${targetPath}`);
      console.log('   npm install');
      console.log('   npm run build');
      console.log('   npm start');

      process.exit(0);

    } catch (error) {
      if (error.message && !(error.stack || '').includes(String(error.message))) {
        console.error('\n❌  Error:', error.message);
      }
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
