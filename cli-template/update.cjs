#!/usr/bin/env node

// noinspection UnnecessaryLocalVariableJS

const fs = require('fs');
const path = require('path');
const https = require('https');
const YAML = require('yaml');
const { execSync, spawn } = require('child_process');
const os = require('os');
const { classifyChanges, readPending, writePending, waitForHealth } = require('./deploy/update-state.cjs');
const { spawnSync } = require('child_process');

const version = '2025.11.25-0506';
console.log(`Update script version: ${version}`);

// Name of this folder
const scriptDirName = require('path').basename(__dirname);
// Changing the working directory to a script directory
process.chdir(__dirname);
const CWD = process.cwd();
const VON = path.resolve(path.join(CWD, '..'));

// Default configuration
const DEFAULT_CONFIG = {
  branch: 'master',
  email: '',
  telegramBotToken: '',
  telegramChatId: '',
};

// Colors for terminal  output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const color = {};
const colorG = {};
['cyan', 'green', 'magenta', 'red', 'yellow'].forEach((col) => {
  const firstLetter = col[0];
  color[firstLetter] = (text) => `${colors.bright}${colors[col]}${text}${colors.reset}`;
  color[`l${firstLetter}`] = (text) => `${colors[col]}${text}${colors.reset}`;
  colorG[firstLetter] = (text) => `${colors.bright}${colors[col]}${text}${colors.green}`;
  colorG[`l${firstLetter}`] = (text) => `${colors[col]}${text}${colors.green}`;
});

// Echo functions with colors
const echo = {
  c: (text) => console.log(color.c(text)),
  lc: (text) => console.log(color.lc(text)),
  g: (text) => console.log(color.g(text)),
  lg: (text) => console.log(color.lg(text)),
  m: (text) => console.log(color.m(text)),
  lm: (text) => console.log(color.lm(text)),
  r: (text) => console.log(color.r(text)),
  lr: (text) => console.log(color.lr(text)),
  y: (text) => console.log(color.y(text)),
  ly: (text) => console.log(color.ly(text)),
  lg_no_newline: (msg) => process.stdout.write(color.lg(msg)),
};

let logBuffer = '';

// Global variable to store NVM environment
let setupScript = '';
let nodeVersion = null;
const DEFAULT_NODE_VERSION = '22.17.1';

const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
const ytdl = timestamp.slice(2, 14); // YYMMDDHHMMSS format
const runTimeLogFile = path.join(VON, `deploy__${scriptDirName}__processing__${ytdl}.log`);
const lastDeployLogFile = path.join(VON, `deploy__${scriptDirName}__last_deploy.log`);
const cumulativeLogFile = path.join(VON, `deploy__${scriptDirName}__cumulative.log`);
// Machine-readable one-line verdict of the last actual update, for external monitors
// (e.g. the deploy skill's `status` / `updatelog`): "SUCCESS|FAIL | <ts> | <detail>".
const pendingFile = path.join(CWD, '.git', 'deploy-update-pending.json');
const statusFile = path.join(VON, `deploy__${scriptDirName}__status.log`);

const clearColors = (text) => text.replace(/\x1B\[[0-9;]*[mGKH]/g, '');
const clearHtmlColors = (text) => text.replace(/<\/?(red|y|g|r|status)>/g, '');

const logIt = (msg, isTitle) => {
  if (isTitle) {
    const lng = 60 - (msg.length + 2);
    const left = Math.floor(lng / 2);
    const right = lng - left;
    msg = `${'='.repeat(left)} ${msg} ${'='.repeat(right)}`;
  }
  const msg4console = clearHtmlColors(msg);
  echo.g(msg4console);
  logBuffer += `${msg}\n`;
  fs.appendFileSync(runTimeLogFile, `${clearColors(msg4console)}\n`);
};

const logError = (msg) => {
  console.error(color.r(msg));
  const msg2 = `[ERROR] ${msg}`;
  logBuffer += `<red>${msg2}</red>\n`;
  fs.appendFileSync(cumulativeLogFile, `${msg2}\n`);
  // Also mirror into the current run log so the last_deploy copy carries the error.
  try {
    fs.appendFileSync(runTimeLogFile, `${msg2}\n`);
  } catch {
    /* runtime log may not exist yet */
  }
};

const nowPretty = () => `${new Date().toISOString().replace('T', ' ').substring(0, 19)}Z`;

/** Write the one-line machine-readable verdict of the current update run. */
const writeStatus = (status, detail = '') => {
  try {
    fs.writeFileSync(statusFile, `${status} | ${nowPretty()} | ${String(detail).split('\n')[0]}\n`);
  } catch {
    /* best effort */
  }
};

/**
 * Truncate cumulative log file if it exceeds 2MB, keeping last 10KB
 */
const truncateCumulativeLogIfNeeded = () => {
  const logFile = path.join(VON, `deploy__${scriptDirName}__cumulative.log`);
  const maxFileSize = 2 * 1024 * 1024; // 2MB
  const keepSize = 10 * 1024; // 10KB

  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > maxFileSize) {
        // Read last 10KB
        const fd = fs.openSync(logFile, 'r');
        const buffer = Buffer.alloc(keepSize);

        // Position to last 10KB
        fs.readSync(fd, buffer, 0, keepSize, stats.size - keepSize);
        fs.closeSync(fd);

        // Write back only the last 10KB
        const tailContent = buffer.toString('utf8').replace(/^[\r\n]*/, ''); // Remove leading newlines
        fs.writeFileSync(logFile, tailContent);

        logIt(`Cumulative log truncated to ${Math.round(tailContent.length / 1024)}KB`);
      }
    }
  } catch (error) {
    logError(`Failed to truncate cumulative log: ${error.message}`);
  }
};

const logTryUpdate = (updateReason = '') => {
  truncateCumulativeLogIfNeeded();
  updateReason = updateReason ? `Update reason: ${updateReason}` : '';
  const message = updateReason || nowPretty();
  fs.appendFileSync(cumulativeLogFile, `${message}\n`);
};

/**
 * Execute command in NVM environment
 */
function execCommand(command, options = {}, withSetupScript = false) {
  // If we have NVM setup, wrap the command
  const fullCommand = setupScript && withSetupScript ? `${setupScript} && ${command}` : command;
  try {
    // noinspection UnnecessaryLocalVariableJS
    const result = execSync(fullCommand, {
      encoding: 'utf8',
      stdio: options.silent ? 'inherit' : 'pipe',
      shell: '/bin/bash',
      ...options,
    });
    return result;
  } catch (error) {
    throw error;
  }
}

function execWithNODE(command, options = {}) {
  return execCommand(command, options, true);
}

/**
 * Load NVM environment and get Node.js version
 */
function loadNVMEnvironment() {
  try {
    if (fs.existsSync('.envrc')) {
      const envrcContent = fs.readFileSync('.envrc', 'utf8');

      // Extract Node.js version from .envrc for logging
      const nodeVersionMatch = envrcContent.match(/nvm use\s+([0-9.]+)/);
      const nodeV = nodeVersionMatch ? nodeVersionMatch[1] : null;

      if (nodeV) {
        nodeVersion = nodeV;
      }
      setupScript = 'source .envrc';
    }
  } catch {
    logError('Error loading .envrc file');
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const pArgs = process.argv.slice(2);
  const args = {
    expectedBranch: null,
    help: false,
    force: false,
  };

  for (let i = 0; i < pArgs.length; i++) {
    const arg = pArgs[i];
    switch (arg) {
      case '-b':
      case '--branch':
        args.expectedBranch = pArgs[++i];
        break;
      case '-f':
      case '--force':
        args.force = true;
        break;
      case '-?':
      case '--help':
        args.help = true;
        break;
    }
  }

  return args;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
================================================================================
    Project update and rebuild

    Usage:
        node update.js [Options]

    Options:

    -b|--branch
        GIT branch name. Default - master
    -l|--log
        Switch to log display mode after completion
    -?|--help
        Display help

    Example: node update.js -b production -l
================================================================================
`);
}

/**
 * Load configuration from deploy/config.yml (proper YAML via the `yaml` package).
 * Telegram, SMTP and the rest are read as nested blocks: `telegram: { botToken, chatId }`,
 * `smtp: { from, host, port, user, pass }`.
 */
function loadConfig() {
  // Load NVM environment from .envrc
  loadNVMEnvironment();

  const configFile = path.join(process.cwd(), 'deploy', 'config.yml');
  if (!fs.existsSync(configFile)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const config = YAML.parse(fs.readFileSync(configFile, 'utf8')) || {};
    const telegram = config.telegram || {};
    const smtp = config.smtp && config.smtp.host ? config.smtp : null;
    return {
      branch: config.branch || DEFAULT_CONFIG.branch,
      nodeVersion: config.nodeVersion,
      healthUrl: config.healthUrl,
      email: config.email || DEFAULT_CONFIG.email,
      smtp,
      telegramBotToken: telegram.botToken || DEFAULT_CONFIG.telegramBotToken,
      telegramChatId: telegram.chatId || DEFAULT_CONFIG.telegramChatId,
    };
  } catch (error) {
    console.warn(`Warning: Could not parse config file ${configFile}:`, error.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Get service name from package.json and .env
 */
function getServiceName() {
  let serviceName = '';
  let serviceInstance = '';
  try {
    if (fs.existsSync('.env')) {
      const envContent = fs.readFileSync('.env', 'utf8');
      let match = envContent.match(/^SERVICE_NAME=([^\r\n]+)/m);
      if (match) {
        serviceName = match[1].trim();
      }
      match = envContent.match(/^SERVICE_INSTANCE=([^\r\n]+)/m);
      if (match) {
        serviceInstance = `--${match[1].trim()}`;
      }
    }
    if (!serviceName) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      serviceName = packageJson.name;
    }

    return {
      serviceName,
      serviceNamePM: `${serviceName}${serviceInstance}`,
    };
  } catch (error) {
    console.error('Error getting service name:', error.message);
    process.exit(1);
  }
}

/**
 * Check if systemctl service exists
 */
function systemctlServiceExists(serviceName) {
  try {
    return execCommand(`systemctl show "${serviceName}.service" -p LoadState --value`).trim() === 'loaded';
  } catch {
    return false;
  }
}

function pm2ServiceExists(serviceName) {
  try {
    const res = execCommand(`pm2 id "${serviceName}"`);
    return /\[\s*\d\s*]/.test(res);
  } catch {
    return false;
  }
}

// True when a usable `mail` command is on PATH. Inside the Docker container there is
// no mail transfer agent, so the e-mail channel is silently skipped there.
function hasMailCommand() {
  try {
    execSync('command -v mail', { stdio: 'ignore', shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

const colorizeHTML = (text) =>
  text
    .replace(/<red>/g, '<span style="color:#ff0000;">')
    .replace(/<\/red>/g, '</span>')
    .replace(/<y>/g, '<span style="background-color:#ffff00;">')
    .replace(/<\/y>/g, '</span>')
    .replace(/<g>/g, '<span style="background-color:#00ff00;">')
    .replace(/<\/g>/g, '</span>')
    .replace(/<r>/g, '<span style="background-color:#ff0000; color:#ffffff;">')
    .replace(/<\/r>/g, '</span>')
    .replace(/\[ERROR]/g, '<span style="color:#ffffff; background-color: #ff0000">[ERROR]</span>');

/**
 * Send a build/restart verdict by e-mail via the system `mail` command.
 * Used on the classic host/systemd deployment. Skipped when no `mail` command
 * exists (e.g. inside the container) or when no address is configured.
 */
async function sendEmailNotification(emails, status, body, serviceName) {
  if (!emails) {
    return;
  }
  if (!hasMailCommand()) {
    logIt('`mail` command not available — e-mail notification skipped');
    return;
  }
  let s = '';
  if (status === 'FAIL') {
    s = `<r>FAIL</r> `;
  } else if (status === 'SUCCESS') {
    s = `<g>SUCCESS</g> `;
  }
  body = body.replace('<status>', s);

  const hostname = os.hostname();
  const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${status} Update ${serviceName} (on ${hostname})</title>
</head>
<body>
<pre>
${colorizeHTML(clearColors(body))}
</pre></body></html>`;

  const emailArray = emails
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email);

  for (let i = 0; i < emailArray.length; i++) {
    const emailAddress = emailArray[i];
    try {
      logIt(`Sending update notification to: ${emailAddress}`);
      const subject = `${status} Update: ${serviceName} (on ${hostname})`;

      const command = `mail -a "Content-Type: text/html; charset=UTF-8" -s "${subject.replace(/"/g, '\\"')}" "${emailAddress}"`;
      const child = spawn('/bin/bash', ['-lc', command], { stdio: ['pipe', 'inherit', 'inherit'] });
      child.stdin.write(htmlContent);
      child.stdin.end();

      await new Promise((resolve, reject) => {
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mail exit code ${code}`))));
        child.on('error', reject);
      });
    } catch (error) {
      console.error(`Failed to send email to ${emailAddress}:`, error.message);
    }
  }
}

/**
 * Send a build/restart verdict by e-mail over SMTP via nodemailer. Used when a `smtp:`
 * block is set in deploy/config.yml — works inside the container (no local MTA needed).
 * Recipient is `email`; sender is `smtp.from` (falling back to `smtp.user`).
 */
async function sendSmtpNotification(config, status, body, serviceName) {
  const { smtp, email } = config;
  if (!smtp) {
    return;
  }
  if (!email) {
    logIt('SMTP configured but no recipient (email) set — notification skipped');
    return;
  }
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    logIt('SMTP configured but nodemailer is not installed — notification skipped');
    return;
  }
  const s = status === 'FAIL' ? '<r>FAIL</r> ' : status === 'SUCCESS' ? '<g>SUCCESS</g> ' : '';
  const hostname = os.hostname();
  const port = Number(smtp.port) || 25;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body><pre>
${colorizeHTML(clearColors(body.replace('<status>', s)))}
</pre></body></html>`;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/25 = STARTTLS/plain
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
    // Internal corporate relays often present self-signed certs; this is only a deploy notice.
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    logIt(`Sending SMTP notification to ${email} via ${smtp.host}:${port}`);
    await transporter.sendMail({
      from: smtp.from || smtp.user,
      to: email,
      subject: `${status} Update: ${serviceName} (on ${hostname})`,
      html,
    });
  } catch (error) {
    console.error(`SMTP send failed: ${error.message}`);
  }
}

/**
 * Send a build/restart verdict to Telegram. Used on the Docker deployment (and
 * anywhere a bot is configured). Credentials come from deploy/config.yml →
 * telegramBotToken / telegramChatId.
 */
function sendTelegramNotification(config, status, body, serviceName) {
  const { telegramBotToken, telegramChatId } = config;
  if (!telegramBotToken || !telegramChatId) {
    logIt('Telegram bot token or chat id not set — notification skipped');
    return Promise.resolve();
  }

  const hostname = os.hostname();
  const icon = status === 'SUCCESS' ? '✅' : '❌';
  let raw = `${icon} ${status} — ${serviceName} @ ${hostname}\n\n${clearColors(clearHtmlColors(body))}`;
  // Telegram hard-limits a single message to 4096 chars; leave room for the code fence + escaping.
  if (raw.length > 3800) {
    raw = `${raw.slice(0, 3800)}\n…(truncated)`;
  }
  // Render as a MarkdownV2 fenced code block (monospace). Inside a code block only backslash and
  // backtick are special, so those are the only characters that need escaping.
  const fenced = '```\n' + raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '\n```';

  const payload = JSON.stringify({
    chat_id: telegramChatId,
    text: fenced,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${telegramBotToken}/sendMessage`,
        method: 'POST',
        timeout: 15000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.error(`Telegram notify HTTP ${res.statusCode}: ${data}`);
          }
          resolve();
        });
      },
    );
    // Don't let an unreachable Telegram (e.g. blocked network) hang the update.
    req.on('timeout', () => req.destroy(new Error('request timed out after 15s')));
    req.on('error', (error) => {
      console.error(`Telegram notify failed: ${error.message}`);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Universal dispatcher: fire every configured notification channel.
 *   * E-mail — via SMTP (nodemailer) when a `smtp:` block is set (works in the container),
 *     otherwise via the system `mail` command (classic host deploy).
 *   * Telegram — when bot credentials exist.
 * Each channel is a no-op when its prerequisites are absent.
 */
async function sendNotifications(config, status, body, serviceName) {
  if (config.smtp) {
    await sendSmtpNotification(config, status, body, serviceName);
  } else {
    await sendEmailNotification(config.email, status, body, serviceName);
  }
  await sendTelegramNotification(config, status, body, serviceName);
}

let scriptsDirName = fs.existsSync(path.join(CWD, '_sh/npm/yarn-ci.sh')) ? '_sh' : 'scripts';

const reinstallDependencies = () => {
  logIt('CLEAN INSTALL DEPENDENCIES', true);

  execCommand('rm -rf node_modules/');
  execWithNODE('yarn install --frozen-lockfile');
  logIt('Dependencies installed');

  // Patch node modules if patch file exists
  const patchFile = path.join(scriptsDirName, 'patch_node_modules.js');
  if (fs.existsSync(patchFile)) {
    logIt('PATCH NODE MODULES', true);
    execWithNODE(`node --no-node-snapshot ${patchFile}`);
    logIt('Node modules patched');
  }
};

const compile = () => {
  logIt('TYPESCRIPT BUILD', true);
  execWithNODE('yarn cb', { silent: true });
  logIt('TypeScript build completed');
};

const buildQuasar = () => {
  if (!fs.existsSync(path.join(CWD, 'quasar.config.js'))) {
    return;
  }
  logIt('BUILD QUASAR', true);
  execWithNODE(`node ./${scriptsDirName}/quasar-prepare-color-vars.mjs`);
  const result = execWithNODE('yarn quasar build');
  logIt(result);
  logIt('Quasar build completed');
};

const restartService = (serviceNamePM) => {
  let srvc = '';
  if (systemctlServiceExists(serviceNamePM)) {
    srvc = 'systemctl';
  } else if (pm2ServiceExists(serviceNamePM)) {
    srvc = 'pm2';
  } else {
    throw new Error(`Service ${serviceNamePM} not found in systemctl or PM2`);
  }
  logIt(`Restarting service ${serviceNamePM} via ${srvc}`, true);
  execCommand(`${srvc} restart "${serviceNamePM}"`);
  logIt(`Service restarted`);
};

/**
 * Main update function
 */
async function main() {
  logTryUpdate();
  fs.writeFileSync(runTimeLogFile, '');
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  // Get service information
  const { serviceName, serviceNamePM } = getServiceName();

  logIt(`<status>Update <y>${colorG.y(serviceName)}</y> ${nowPretty()}`);

  logIt(`Working directory: ${colorG.y(CWD)}`);
  // Load configuration
  const config = loadConfig();

  let from = ' DEFAULT';
  if (nodeVersion) {
    from = ' .envrc';
  } else if (config.nodeVersion) {
    ({ nodeVersion } = config);
    from = ' deploy/config.yaml';
  }

  logIt(`Using Node.js version: ${nodeVersion || DEFAULT_NODE_VERSION}${from}`);

  // Override branch if specified in arguments
  const expectedBranch = args.expectedBranch || config.branch;
  let updateDeployedLogFile = false;
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(expectedBranch) || expectedBranch.includes('..')) {
      throw new Error('Invalid deployment branch');
    }
    execCommand(`git fetch origin ${expectedBranch} --prune`);
    const target = `origin/${expectedBranch}`;
    const before = execCommand('git rev-parse HEAD').trim();
    const after = execCommand(`git rev-parse ${target}`).trim();
    const pending = readPending(pendingFile);
    const files = [
      execCommand(`git diff --name-only HEAD ${target}`),
      execCommand('git diff --name-only'),
      execCommand('git diff --cached --name-only'),
    ]
      .join('\n')
      .split(/\r?\n/)
      .filter(Boolean);
    const changes = classifyChanges(files);
    changes.dependencies ||= Boolean(pending?.dependencies) || !fs.existsSync('node_modules');
    changes.build ||= changes.dependencies || Boolean(pending?.build) || !fs.existsSync('dist');
    const branch = execCommand('git branch --show-current').trim();
    const needUpdate =
      before !== after ||
      branch !== expectedBranch ||
      files.length > 0 ||
      pending ||
      changes.dependencies ||
      changes.build;
    const updateReason = `${before} -> ${after}${pending ? ' (retry pending update)' : ''}`;
    if (needUpdate || args.force) {
      updateDeployedLogFile = true;
      writePending(pendingFile, { ...changes, before, after });
      logTryUpdate(updateReason);
      execCommand(`git checkout -f -B ${expectedBranch} ${target}`);
      execCommand(`git reset --hard ${target}`);
      execCommand('git clean -fd');
      if (changes.dependencies) {
        reinstallDependencies();
      }
      if (changes.build) {
        compile();
        buildQuasar();
      }
      restartService(serviceNamePM);
      let { healthUrl } = config;
      if (!healthUrl) {
        const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
        const local = fs.existsSync('config/local.yaml')
          ? YAML.parse(fs.readFileSync('config/local.yaml', 'utf8'))
          : {};
        const defaults = fs.existsSync('config/default.yaml')
          ? YAML.parse(fs.readFileSync('config/default.yaml', 'utf8'))
          : {};
        const port = env.match(/^WS_PORT=(\d+)\s*$/m)?.[1] || local?.webServer?.port || defaults?.webServer?.port;
        if (!port) {
          throw new Error('Set healthUrl in deploy/config.yml or webServer.port in config/local.yaml');
        }
        healthUrl = `http://127.0.0.1:${port}/health`;
      }
      await waitForHealth(healthUrl);
      if (systemctlServiceExists(serviceNamePM)) {
        execCommand(`systemctl is-active --quiet "${serviceNamePM}"`);
      }
      fs.rmSync(pendingFile, { force: true });

      // Add completion info to build log
      logIt(`Update completed successfully at ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`);
      writeStatus('SUCCESS', updateReason || 'update completed');
      // Notify via every configured channel (e-mail and/or Telegram)
      await sendNotifications(config, 'SUCCESS', logBuffer, serviceName);
    } else {
      logIt('No changes detected. Update skipped.');
    }
  } catch (err) {
    const message = String(err.message).includes(err.stderr) ? err.message : [err.stderr, err.message].join('\n');
    process.exitCode = 1;
    logError(message);
    try {
      logIt(execCommand(`journalctl -u "${serviceNamePM}" -n 80 --no-pager`));
    } catch {
      /* Preserve original failure. */
    }
    writeStatus('FAIL', message);
    await sendNotifications(config, 'FAIL', logBuffer, serviceName);
  } finally {
    logIt('#FINISH#');
    if (updateDeployedLogFile) {
      fs.copyFileSync(runTimeLogFile, lastDeployLogFile);
    }
    execCommand(`rm -rf "${runTimeLogFile}"`);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\nUpdate process interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\nUpdate process terminated');
  process.exit(1);
});

// Serialize cron and manual updates; flock releases its lock even after an interrupted process.
if (process.platform === 'linux' && !process.env.MCP_UPDATE_LOCKED) {
  const locked = spawnSync(
    'flock',
    [
      '-n',
      '-E',
      '75',
      path.join(CWD, '.git', 'deploy-update.lock'),
      process.execPath,
      __filename,
      ...process.argv.slice(2),
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, MCP_UPDATE_LOCKED: '1' },
    },
  );
  if (locked.status === 75) {
    console.log('Another update is running; retry later.');
  }
  process.exit(locked.status ?? 1);
}

main()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error('Update failed:', error.message);
    process.exit(1);
  });
