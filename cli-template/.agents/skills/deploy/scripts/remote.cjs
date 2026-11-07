#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Generic remote deployment orchestrator for an fa-mcp-sdk MCP server
// (runs on the developer workstation). Project-agnostic: copy this skill into any
// such project, fill in the config, and it works. Everything project-specific is
// derived from the host project (package.json name, .envrc node version) or read
// from config.yaml — nothing is hard-coded here.
//
// Model: a self-contained systemd Docker image (docker/Dockerfile) carrying no app
// code; at boot it clones the repo (read-only Deploy Key delivered as a private file), writes
// config/local.yaml (from config/local.yaml) + deploy/config.yml + .env, builds,
// installs the app as a systemd service, and runs update.cjs from cron every minute.
//
// This orchestrator only: builds the image on the server context-lessly
// (`docker build -`), runs the container, wires up the reverse proxy, drives lifecycle.
//
//   node remote.cjs keygen      # create a read-only GitHub Deploy Key
//   node remote.cjs deploy      # build image + (re)create container + Caddy
//   node remote.cjs status      # diagnostics
//   node remote.cjs stop        # stop the container (auto-update stops with it)
//   node remote.cjs start       # start the container
//   node remote.cjs restart     # restart just the app service (fast, no rebuild)
//   node remote.cjs push-config # generate and deliver application/update settings, then restart
//   node remote.cjs update      # force update.cjs --force inside the container
//   node remote.cjs logs [N]    # last N app-service journal lines (default 200)
//   node remote.cjs updatelog   # auto-update verdict + error scan + last-run log
//   node remote.cjs uninstall --yes   # remove container, image, project checkout and reverse proxy
//   node remote.cjs ssh         # print the raw ssh command
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Selected explicitly; never fall back to another installation.
let CONFIG_DIR, CONFIG_FILE, LOCAL_YAML_FILE;
function selectServer(args) {
  const rest = [];
  let alias;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') {
      rest.push(...args.slice(i));
      break;
    }
    if (args[i] === '--server') {
      if (alias || !args[i + 1]) fail('Specify --server <alias> exactly once.');
      alias = args[++i];
    } else rest.push(args[i]);
  }
  if (!alias || alias === '_example' || !/^[a-z0-9][a-z0-9_.-]*$/.test(alias)) {
    fail('Specify --server <alias>: an existing folder in configs/. No default server is selected.');
  }
  CONFIG_DIR = path.join(__dirname, '..', 'configs', alias);
  CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
  LOCAL_YAML_FILE = path.join(CONFIG_DIR, 'local.yaml');
  if (!fs.existsSync(path.join(CONFIG_DIR, 'rules.md'))) fail(`Missing installation rules: configs/${alias}/rules.md`);
  return { alias, rest };
}
const DOCKERFILE = path.join(__dirname, '..', 'docker', 'Dockerfile');
// Host project root: .agents/skills/<skill>/scripts/remote.cjs -> up four levels.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Stable node path baked into the image (a symlink to the nvm-installed node), so
// nothing here depends on a specific node version directory.
const NODE_BIN = '/usr/local/bin/node';

// Derived names — set once in main() from the resolved config (see resolveNames()).
let CONTAINER, IMAGE, SERVICE, UPSTREAM, NODE_VERSION;

// ── Minimal nested-YAML reader (maps + scalars, 2-space indent, no arrays) ────
function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ').replace(/(^|\s)#.*$/, '$1');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (value === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = value.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return root;
}

// Container paths of the update.cjs bookkeeping logs (VON = parent of the project dir,
// name = its basename): deploy__<name>__status.log / __last_deploy.log / __cumulative.log.
function logPaths(cfg) {
  const p = cfg.projectPath.replace(/\/+$/, '');
  const von = p.replace(/\/[^/]+$/, '') || '/';
  const name = p.replace(/^.*\//, '');
  const base = `${von}/deploy__${name}__`;
  return { status: `${base}status.log`, lastDeploy: `${base}last_deploy.log`, cumulative: `${base}cumulative.log` };
}

function fail(msg) {
  console.error(`\x1b[1;31m[remote][ERROR]\x1b[0m ${msg}`);
  process.exit(1);
}
function say(msg) {
  console.log(`\x1b[1;36m[remote]\x1b[0m ${msg}`);
}
function b64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
function sq(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

// Docker/systemd-safe identifier derived from an arbitrary project name.
function sanitizeName(n) {
  return (
    String(n)
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/\//g, '-')
      .replace(/[^a-z0-9_.-]/g, '-') || 'mcp-app'
  );
}

// Service/container base name — from config override, else the host project's package.json name.
function readProjectName(cfg) {
  if (cfg.service && cfg.service.name) return sanitizeName(cfg.service.name);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    if (pkg.name) return sanitizeName(pkg.name);
  } catch {
    /* fall through */
  }
  return 'mcp-app';
}

function readPackageName() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    if (pkg.name) return sanitizeName(pkg.name);
  } catch {
    /* fall through */
  }
  return 'mcp-app';
}

function restartAliasCandidates(value) {
  const words = String(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return ['mcp'];
  const base = words.map((word) => Array.from(word)[0]).join('');
  const last = Array.from(words.at(-1));
  const candidates = [base];
  for (let length = 2; length <= last.length; length++) {
    candidates.push(`${base}${last.slice(1, length).join('')}`);
  }
  return [...new Set(candidates)];
}

// Node version to bake into the image — from config override, else the project's .envrc
// (`nvm use X.Y.Z`); srv.cjs reads the same .envrc, so they must match.
function readNodeVersion(cfg) {
  if (cfg.container && cfg.container.nodeVersion) return String(cfg.container.nodeVersion);
  try {
    const m = fs.readFileSync(path.join(PROJECT_ROOT, '.envrc'), 'utf8').match(/nvm\s+use\s+([0-9]+\.[0-9]+\.[0-9]+)/);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return '22.17.1';
}

function loadConfig(alias) {
  if (!fs.existsSync(CONFIG_FILE)) {
    fail(
      `Config not found: ${CONFIG_FILE}\nCopy configs/_example/ to the selected installation folder and fill it in.`,
    );
  }
  if (!fs.existsSync(LOCAL_YAML_FILE)) {
    fail(`Missing ${LOCAL_YAML_FILE}\nCopy configs/_example/local.yaml to the selected installation folder.`);
  }
  if (fs.existsSync(path.join(CONFIG_DIR, 'config.yml'))) {
    fail(`Move config.yml settings into config.yaml: branch to project.branch, others to update; then remove config.yml.`);
  }
  const configText = fs.readFileSync(CONFIG_FILE, 'utf8');
  const cfg = parseYaml(configText);
  const server = cfg.server || {};
  const project = cfg.project || {};
  const deployment = cfg.deployment || {};
  const git = cfg.git || {};
  const mcp = cfg.mcp || {};
  const envSection = cfg.env || {};
  const req = (v, name) => {
    if (!v || /[<>]/.test(String(v))) fail(`Missing required config value: ${name}`);
    return v;
  };

  // The app's config/local.yaml, copied verbatim into the container. Parsed only for the
  // listening port (webServer.port) — nothing else is read from it.
  const localYaml = fs.readFileSync(LOCAL_YAML_FILE, 'utf8');
  const local = parseYaml(localYaml);

  // Preserve notification values verbatim, including quoted secrets and YAML scalar types.
  // Only the update section is delivered; workstation connection settings stay local.
  const updateBlock = configText.match(/^update:[ \t]*(?:#.*)?\r?\n((?:(?:[ \t]+[^\n]*|)[\n]|[ \t]+[^\n]*$)*)/m);
  if (cfg.update && !updateBlock) fail('Use an indented YAML mapping for update settings.');
  if (cfg.update?.branch) fail('Set the deployment branch only in project.branch.');
  const updateYaml = (updateBlock?.[1] || '').replace(/^  /gm, '');
  const branch = project.branch || 'master';
  const deployYml = `branch: ${JSON.stringify(branch)}\n${updateYaml}`;
  const dcfg = cfg.update || {};

  const name = cfg.service?.name ? readProjectName(cfg) : `${readProjectName(cfg)}-${alias}`;
  const instance = (cfg.service && cfg.service.instance) || 'prod';
  const deploymentMode = deployment.mode || 'systemd';
  const safe = (value, pattern, label) => {
    if (!pattern.test(String(value))) fail(`Invalid ${label}`);
  };
  safe(instance, /^[a-zA-Z0-9_.-]+$/, 'service.instance');
  safe(deploymentMode, /^(?:systemd|docker)$/, 'deployment.mode');
  safe(readNodeVersion(cfg), /^\d+\.\d+\.\d+$/, 'container.nodeVersion');
  safe(mcp.dns, /^(?=.{1,253}$)[a-zA-Z0-9][a-zA-Z0-9.-]*$/, 'mcp.dns');
  for (const [value, label] of [
    [local.webServer?.port || '9049', 'webServer.port'],
    [server.port || '22', 'server.port'],
  ]) {
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) fail(`Invalid ${label}`);
  }
  for (const key of ['projectPath', 'statePath']) {
    if (project[key] && (!/^\/[a-zA-Z0-9_./-]+$/.test(project[key]) || project[key].split('/').includes('..'))) {
      fail(`Invalid project.${key}`);
    }
  }
  if (
    project.cacheDir &&
    (!/^[a-zA-Z0-9_./-]+$/.test(project.cacheDir) ||
      project.cacheDir.startsWith('/') ||
      project.cacheDir.split('/').includes('..'))
  )
    fail('Invalid project.cacheDir');
  const projectPath = project.projectPath || `/opt/node/${name}`;
  const cacheDir = project.cacheDir || 'data-cache';
  if (deploymentMode === 'systemd' && project.statePath) {
    fail('project.statePath is available only in docker mode; systemd uses projectPath/cacheDir directly');
  }
  const statePath = deploymentMode === 'systemd' ? `${projectPath}/${cacheDir}` : project.statePath || `/opt/${name}`;
  return {
    alias,
    name,
    instance,
    deploymentMode,
    restartAliasCandidates: restartAliasCandidates(cfg.service?.aliasSource || readPackageName()),
    nodeVersion: readNodeVersion(cfg),
    host: req(server.host, 'server.host'),
    port: server.port || '22',
    user: req(server.user, 'server.user'),
    keyPath: req(server.keyPath, 'server.keyPath'),
    repoUrl: req(project.repoUrl || git.repoUrl, 'project.repoUrl'),
    deployKeyPath: git.deployKeyPath || project.deployKeyPath || '',
    branch,
    projectPath,
    statePath,
    // Subdir inside the project the persistent statePath is bind-mounted onto
    // (the app's on-disk cache). Default suits fa-mcp-sdk apps; override if needed.
    cacheDir,
    dns: req(mcp.dns, 'mcp.dns'),
    reverseProxy: mcp.reverseProxy !== 'false',
    appHost: local.webServer?.host || '127.0.0.1',
    publicUrl: mcp.publicUrl || (mcp.reverseProxy === 'false'
      ? `http://${mcp.dns}:${local.webServer?.port || '9049'}`
      : `https://${mcp.dns}`),
    email: dcfg.email || '',
    debug: envSection.DEBUG || 'config-info',
    appPort: (local.webServer && local.webServer.port) || '9049',
    localYaml, // verbatim -> container config/local.yaml
    deployConfigYaml: `${deployYml.replace(/\n*$/, '')}\n`, // generated -> container deploy/config.yml
  };
}

// ── SSH helpers ──────────────────────────────────────────────────────────────
function sshBaseArgs(cfg) {
  return [
    '-i',
    cfg.keyPath,
    '-p',
    String(cfg.port),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=15',
    `${cfg.user}@${cfg.host}`,
  ];
}

// Execute on the server. For non-interactive runs the script is streamed to a
// remote `bash -l` over stdin — no base64, no command-line length limits (large
// scripts embedding keys/config would otherwise overflow a single ssh argument).
// For interactive runs, `script` is a ready remote command (small) run under a TTY.
function sshRun(cfg, script, { interactive = false } = {}) {
  if (interactive) {
    const res = spawnSync('ssh', ['-t', ...sshBaseArgs(cfg), script], { stdio: 'inherit' });
    if (res.error) fail(`ssh failed to start: ${res.error.message}`);
    if (res.status !== 0) process.exitCode = res.status || 1;
    return res.status;
  }
  const res = spawnSync('ssh', [...sshBaseArgs(cfg), 'bash -l'], {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (res.error) fail(`ssh failed to start: ${res.error.message}`);
  if (res.status !== 0) process.exitCode = res.status || 1;
  return res.status;
}

// Pipe local data to a remote command's stdin (used for `docker build -`).
function sshPipe(cfg, remoteCmd, input) {
  const res = spawnSync('ssh', [...sshBaseArgs(cfg), remoteCmd], {
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (res.error) fail(`ssh failed to start: ${res.error.message}`);
  if (res.status !== 0) process.exitCode = res.status || 1;
  return res.status;
}

function caddyBlock(cfg) {
  return [
    `# ${cfg.dns} — reverse proxy to the Docker container on 127.0.0.1:${cfg.appPort}`,
    `${cfg.dns} {`,
    '\tencode gzip',
    `\treverse_proxy 127.0.0.1:${cfg.appPort} {`,
    '\t\ttransport http {',
    '\t\t\tread_timeout 120s',
    '\t\t\twrite_timeout 120s',
    '\t\t}',
    '\t}',
    `\tlog {`,
    `\t\toutput file /var/log/caddy/${cfg.dns}.log`,
    '\t}',
    '}',
  ].join('\n');
}

// nginx server block (HTTP). certbot --nginx later adds the 443 listener + redirect.
function nginxBlock(cfg) {
  return [
    `upstream ${UPSTREAM} { server 127.0.0.1:${cfg.appPort}; keepalive 8; }`,
    'server {',
    '    listen 80;',
    `    server_name ${cfg.dns};`,
    `    access_log /var/log/nginx/${cfg.dns}.log;`,
    `    error_log  /var/log/nginx/${cfg.dns}.ERROR.log;`,
    '    client_max_body_size 2m;',
    '    gzip on;',
    '    gzip_types application/json text/plain text/markdown;',
    '',
    '    location / {',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Connection "";',
    '        proxy_set_header Host $http_host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_buffering off;',
    '        proxy_read_timeout 3600s;',
    '        proxy_send_timeout 3600s;',
    `        proxy_pass http://${UPSTREAM};`,
    '        proxy_redirect off;',
    '    }',
    '}',
  ].join('\n');
}

// fa-mcp-sdk reverse-proxy templates shipped in the project under deploy/.
const TPL = {
  nginxSite: path.join(PROJECT_ROOT, 'deploy', 'NGINX', 'sites-enabled', 'mcp-template.com.conf'),
  nginxSnippet: path.join(PROJECT_ROOT, 'deploy', 'NGINX', 'snippets', 'mcp-proxy.conf'),
  caddyfile: path.join(PROJECT_ROOT, 'deploy', 'CADDY', 'Caddyfile'),
};

function renderTemplate(text, cfg) {
  return text
    .replace(/\{\{mcp\.domain\}\}/g, cfg.dns)
    .replace(/\{\{upstream\}\}/g, UPSTREAM)
    .replace(/\{\{port\}\}/g, String(cfg.appPort));
}

// Render the fa-mcp-sdk nginx site for a certbot (Let's Encrypt per-domain) certificate:
// swap the template's wildcard-cert SSL trio for certbot's own paths + shared params.
function renderNginxSiteCertbot(cfg) {
  if (!fs.existsSync(TPL.nginxSite)) return null;
  let t = renderTemplate(fs.readFileSync(TPL.nginxSite, 'utf8'), cfg);
  const certbotSsl =
    `\n    ssl_certificate /etc/letsencrypt/live/${cfg.dns}/fullchain.pem;` +
    `\n    ssl_certificate_key /etc/letsencrypt/live/${cfg.dns}/privkey.pem;` +
    `\n    include /etc/letsencrypt/options-ssl-nginx.conf;`;
  const swapped = t.replace(
    /\n\s*include \{\{ssl-wildcard\.conf\.rel\.path\}\};\n\s*include snippets\/ssl-params\.conf;\n\s*ssl_protocols\s+TLSv1\.3;/,
    certbotSsl,
  );
  return swapped === t ? null : swapped; // null if the SSL block wasn't found (template drift)
}

// Extract the `<dns> { … }` site block from the (rendered) Caddy template, balancing braces,
// so it can be dropped into a shared Caddyfile that already serves other sites.
function renderCaddySiteBlock(cfg) {
  if (!fs.existsSync(TPL.caddyfile)) return null;
  const t = renderTemplate(fs.readFileSync(TPL.caddyfile, 'utf8'), cfg);
  // The site block opens with `<dns> {` at the START of a line — not the `<dns> { … }`
  // reference that also appears inside the header comment.
  const m = t.match(new RegExp(`^${cfg.dns.replace(/\./g, '\\.')} \\{`, 'm'));
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  for (let i = t.indexOf('{', start); i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}' && --depth === 0) return t.slice(start, i + 1);
  }
  return null;
}

// Caddy branch: append the rendered fa-mcp-sdk site block to the shared Caddyfile, transactionally
// (validate a temp copy first, overwrite the live file only if it passes). Falls back to a minimal
// block if the template is missing.
function caddyBody(cfg) {
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  const block = renderCaddySiteBlock(cfg) || caddyBlock(cfg);
  const source = renderCaddySiteBlock(cfg) ? 'fa-mcp-sdk template' : 'minimal fallback block';
  return `
CF=/etc/caddy/Caddyfile
if grep -qE "^\\s*${dnsEsc}\\s*\\{" "$CF" 2>/dev/null; then
  echo "Caddy already has a block for ${cfg.dns} — removing it to re-apply the current template."
  BK="$(mktemp)"; cp "$CF" "$BK"
  awk 'BEGIN{skip=0}
    /^[[:space:]]*${dnsEsc}[[:space:]]*\\{/{skip=1; next}
    skip==1 && /^\\}/{skip=0; next}
    skip==0{print}' "$BK" > "$CF"; rm -f "$BK"
fi
echo "Appending Caddy block for ${cfg.dns} (${source})..."
# Caddy runs as its own user; pre-create the per-site log owned like the log dir so reload can open it.
mkdir -p /var/log/caddy
touch /var/log/caddy/${cfg.dns}.log
chown --reference=/var/log/caddy /var/log/caddy/${cfg.dns}.log 2>/dev/null || true
TMP="$(mktemp)"
cp "$CF" "$TMP"
printf '\\n%s\\n' ${sq(block)} >> "$TMP"
if caddy validate --adapter caddyfile --config "$TMP" >/dev/null 2>&1; then
  cp "$TMP" "$CF"; rm -f "$TMP"
  systemctl reload caddy && echo "Caddy reloaded — ${cfg.dns} is live."
else
  rm -f "$TMP"
  echo "ERROR: Caddy validation failed — the live Caddyfile was left UNCHANGED. Not adding ${cfg.dns}."
  exit 1
fi`;
}

// nginx branch: install the shared proxy snippet, obtain a certbot certificate, then write the
// rendered fa-mcp-sdk site (split locations, SSE-friendly). Falls back to a single-location block
// if the template is missing.
function nginxBody(cfg) {
  const email = cfg.email ? `-m ${cfg.email}` : '--register-unsafely-without-email';
  const site = renderNginxSiteCertbot(cfg);
  if (!site || !fs.existsSync(TPL.nginxSnippet)) return nginxBodyFallback(cfg, email);
  const siteB64 = b64(site);
  const snippetB64 = b64(fs.readFileSync(TPL.nginxSnippet, 'utf8'));
  return `
echo 'nginx: applying fa-mcp-sdk template (split MCP/SSE locations).'
mkdir -p /etc/nginx/snippets
echo ${snippetB64} | base64 -d > /etc/nginx/snippets/mcp-proxy.conf
# The site references the cert, so obtain it first (certonly does not touch other configs).
if [ ! -d "/etc/letsencrypt/live/${cfg.dns}" ]; then
  echo "Obtaining TLS certificate via certbot for ${cfg.dns}..."
  certbot certonly --nginx -d ${cfg.dns} --non-interactive --agree-tos ${email} || {
    echo "WARNING: certbot failed for ${cfg.dns} (DNS not pointing here yet, or port 80 blocked). HTTPS site not written."; exit 0; }
fi
if [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
  printf 'ssl_protocols TLSv1.2 TLSv1.3;\\nssl_prefer_server_ciphers off;\\n' > /etc/letsencrypt/options-ssl-nginx.conf
fi
SITE=/etc/nginx/sites-available/${cfg.dns}.conf
LINK=/etc/nginx/sites-enabled/${cfg.dns}.conf
echo ${siteB64} | base64 -d > "$SITE"
ln -sf "$SITE" "$LINK"
if nginx -t 2>&1 | tail -2; then
  systemctl reload nginx && echo "nginx (fa-mcp-sdk template) + HTTPS live for ${cfg.dns}."
else
  echo "ERROR: nginx -t failed for ${cfg.dns}. Review $SITE."
  exit 1
fi`;
}

// Minimal single-location nginx site + certbot --nginx (used only if the template is absent).
function nginxBodyFallback(cfg, email) {
  return `
echo 'nginx: template not found — using the minimal fallback block.'
SITE=/etc/nginx/sites-available/${cfg.dns}.conf
LINK=/etc/nginx/sites-enabled/${cfg.dns}.conf
if [ ! -f "$SITE" ]; then
  cat > "$SITE" <<'NGINXEOF'
${nginxBlock(cfg)}
NGINXEOF
fi
ln -sf "$SITE" "$LINK"
if ! nginx -t 2>&1 | tail -2; then echo "ERROR: nginx -t failed for ${cfg.dns}."; exit 1; fi
systemctl reload nginx
if [ ! -d "/etc/letsencrypt/live/${cfg.dns}" ]; then
  certbot --nginx -d ${cfg.dns} --non-interactive --agree-tos ${email} --redirect \
    && nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "nginx + HTTPS live for ${cfg.dns}." \
    || echo "WARNING: certbot failed for ${cfg.dns} — HTTP proxy is live; re-run deploy once DNS resolves."
else
  echo "TLS certificate for ${cfg.dns} already present."
fi`;
}

// Detect the reverse proxy present on the host and configure it for <dns>.
function reverseProxySnippet(cfg) {
  return `
if systemctl is-active --quiet caddy 2>/dev/null; then
  echo 'Reverse proxy: Caddy detected.'
${caddyBody(cfg)}
elif command -v nginx >/dev/null 2>&1; then
  echo 'Reverse proxy: nginx detected.'
${nginxBody(cfg)}
else
  echo "WARNING: neither Caddy nor nginx found — set up a reverse proxy for ${cfg.dns} -> 127.0.0.1:${cfg.appPort} manually."
fi`;
}

// ── Subcommands ──────────────────────────────────────────────────────────────
function cmdKeygen(cfg) {
  const target = cfg.deployKeyPath || path.join(path.dirname(cfg.keyPath), `${cfg.name}-deploy`);
  if (fs.existsSync(target)) {
    say(`Key already exists: ${target}`);
  } else {
    say(`Generating read-only Deploy Key: ${target}`);
    const res = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', target, '-C', `${cfg.name}-deploy`], {
      stdio: 'inherit',
    });
    if (res.status !== 0) fail('ssh-keygen failed.');
  }
  const pub = fs.readFileSync(`${target}.pub`, 'utf8').trim();
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Add this PUBLIC key to GitHub as a READ-ONLY Deploy Key:');
  console.log('  repo → Settings → Deploy keys → Add deploy key');
  console.log(`  Title: ${cfg.name} server    Allow write access: LEAVE UNCHECKED`);
  console.log('──────────────────────────────────────────────────────────────');
  console.log(pub);
  console.log('──────────────────────────────────────────────────────────────');
  if (!cfg.deployKeyPath) {
    console.log(`Then set  git.deployKeyPath: ${target}  in ${CONFIG_FILE}`);
  }
}

function restartAliasRegistrationScript(cfg) {
  const candidates = cfg.restartAliasCandidates.map(sq).join(' ');
  return `
if command -v restart >/dev/null 2>&1; then
  ALIAS_LIST=$(restart ls 2>/dev/null || true)
  RESTART_ALIAS=''
  for CANDIDATE in ${candidates}; do
    CURRENT=$(printf '%s\n' "$ALIAS_LIST" | awk -v alias="$CANDIDATE" '$1 == alias && $2 == "->" { print $3 }')
    if [ -z "$CURRENT" ]; then
      restart add "$CANDIDATE" ${SERVICE}
      RESTART_ALIAS="$CANDIDATE"
      break
    fi
    if [ "$CURRENT" = ${sq(SERVICE)} ]; then
      RESTART_ALIAS="$CANDIDATE"
      echo "Restart alias already registered: $RESTART_ALIAS -> ${SERVICE}"
      break
    fi
  done
  if [ -z "$RESTART_ALIAS" ]; then
    PREFIX=${sq(cfg.restartAliasCandidates.at(-1))}
    SUFFIX=2
    while :; do
      CANDIDATE="\${PREFIX}\${SUFFIX}"
      CURRENT=$(printf '%s\n' "$ALIAS_LIST" | awk -v alias="$CANDIDATE" '$1 == alias && $2 == "->" { print $3 }')
      if [ -z "$CURRENT" ]; then
        restart add "$CANDIDATE" ${SERVICE}
        RESTART_ALIAS="$CANDIDATE"
        break
      fi
      SUFFIX=$((SUFFIX + 1))
    done
  fi
  echo "Restart alias: $RESTART_ALIAS -> ${SERVICE}"
else
  echo 'Command restart is not installed; alias registration skipped.'
fi`;
}

function cmdDeploySystemd(cfg) {
  if (!cfg.deployKeyPath) fail('git.deployKeyPath is not set. Run: node remote.cjs keygen');
  if (!fs.existsSync(cfg.deployKeyPath))
    fail(`Deploy key not found: ${cfg.deployKeyPath}. Run: node remote.cjs keygen`);

  const keyB64 = b64(fs.readFileSync(cfg.deployKeyPath, 'utf8'));
  const localYamlB64 = b64(cfg.localYaml);
  const deployCfgB64 = b64(cfg.deployConfigYaml);
  const cronName = sanitizeName(cfg.name);
  const script = `
set -euo pipefail
umask 077
PROJECT_PATH=${sq(cfg.projectPath)}
STATE_PATH=${sq(cfg.statePath)}
CACHE_PATH="$PROJECT_PATH/${cfg.cacheDir}"
DEPLOY_KEY="$HOME/.ssh/${cfg.name}-deploy"
SECRET_DIR=$(mktemp -d)
trap 'rm -rf -- "$SECRET_DIR"' EXIT

for COMMAND in git node npm systemctl; do
  command -v "$COMMAND" >/dev/null 2>&1 || { echo "Required command is missing: $COMMAND" >&2; exit 1; }
done
printf '%s' ${sq(keyB64)} | base64 -d > "$SECRET_DIR/id_ed25519"
printf '%s' ${sq(localYamlB64)} | base64 -d > "$SECRET_DIR/local.yaml"
printf '%s' ${sq(deployCfgB64)} | base64 -d > "$SECRET_DIR/config.yml"
mkdir -p "$HOME/.ssh" "$PROJECT_PATH"
chmod 700 "$HOME/.ssh"
install -m 600 "$SECRET_DIR/id_ed25519" "$DEPLOY_KEY"
GIT_HOST=$(node -p 'new URL(process.argv[1]).hostname' ${sq(cfg.repoUrl)})
GIT_PORT=$(node -p 'new URL(process.argv[1]).port || 22' ${sq(cfg.repoUrl)})
ssh-keyscan -p "$GIT_PORT" -t ed25519,rsa "$GIT_HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null
sort -u "$HOME/.ssh/known_hosts" -o "$HOME/.ssh/known_hosts"
chmod 600 "$HOME/.ssh/known_hosts"

git config --global --add safe.directory "$PROJECT_PATH"
cd "$PROJECT_PATH"
if [ ! -d .git ]; then
  UNEXPECTED=$(find . -mindepth 1 -maxdepth 1 ! -name ${sq(cfg.cacheDir.split('/')[0])} -print -quit)
  if [ -n "$UNEXPECTED" ]; then
    echo "Project path contains data other than the permitted cache directory: $UNEXPECTED" >&2
    exit 1
  fi
  git init -q
  git remote add origin ${sq(cfg.repoUrl)}
else
  git remote set-url origin ${sq(cfg.repoUrl)}
fi
git config core.sshCommand "ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git fetch --prune origin ${sq(cfg.branch)}
git checkout -f -B ${sq(cfg.branch)} origin/${cfg.branch}
git branch --set-upstream-to=origin/${cfg.branch} ${sq(cfg.branch)} 2>/dev/null || true
git clean -fd -e ${sq(`/${cfg.cacheDir}/`)}

if [ -L "$CACHE_PATH" ]; then
  echo "Systemd mode requires a real cache directory, not a symbolic link: $CACHE_PATH" >&2
  exit 1
fi
mkdir -p "$CACHE_PATH"
chmod 700 "$CACHE_PATH"

mkdir -p config deploy
install -m 600 "$SECRET_DIR/local.yaml" config/local.yaml
install -m 600 "$SECRET_DIR/config.yml" deploy/config.yml
cat > .env <<'MCP_ENV'
SERVICE_NAME=${cfg.name}
SERVICE_INSTANCE=${cfg.instance}
NODE_ENV=production
DEBUG=${cfg.debug}
WS_HOST=${cfg.appHost}
WS_PORT=${cfg.appPort}
WS_PUBLIC_BASE_URL=${cfg.publicUrl}
MCP_ENV
chmod 600 .env

export HOME=${sq('/root')}
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  set +u
  . "$NVM_DIR/nvm.sh"
  nvm use ${sq(cfg.nodeVersion)} >/dev/null
  set -u
fi
ACTUAL_NODE=$(node --version | sed 's/^v//')
[ "$ACTUAL_NODE" = ${sq(cfg.nodeVersion)} ] || {
  echo "Node.js ${cfg.nodeVersion} is required, found $ACTUAL_NODE" >&2; exit 1; }
node scripts/runtime/run-progress.cjs dependencies npm ci --no-audit --no-fund
node scripts/runtime/run-progress.cjs build npm run cb
node deploy/srv.cjs install
systemctl restart ${SERVICE}

NODE_BIN=$(command -v node)
cat > /etc/cron.d/mcp-update-${cronName} <<CRON
* * * * * root $NODE_BIN $PROJECT_PATH/update.cjs >/tmp/mcp-update-${cronName}.log 2>&1
CRON
chmod 0644 /etc/cron.d/mcp-update-${cronName}
${restartAliasRegistrationScript(cfg)}
${healthScript(cfg)}
${cfg.reverseProxy ? reverseProxySnippet(cfg) : "echo 'Direct internal connection; nginx settings remain unchanged.'"}
`;
  say(`Deploying ${cfg.name} as a host systemd service on ${cfg.user}@${cfg.host}`);
  const code = sshRun(cfg, script);
  if (code !== 0) fail(`Deploy failed (exit ${code}). Run: node remote.cjs --server ${cfg.alias} status`);
  say(`Done. systemd service ${SERVICE} is ready at ${cfg.publicUrl}`);
}

function cmdDeployDocker(cfg) {
  if (!cfg.deployKeyPath) fail('git.deployKeyPath is not set. Run: node remote.cjs keygen');
  if (!fs.existsSync(cfg.deployKeyPath))
    fail(`Deploy key not found: ${cfg.deployKeyPath}. Run: node remote.cjs keygen`);
  if (!fs.existsSync(DOCKERFILE)) fail(`Dockerfile not found: ${DOCKERFILE}`);

  const keyB64 = b64(fs.readFileSync(cfg.deployKeyPath, 'utf8'));
  const localYamlB64 = b64(cfg.localYaml);
  const deployCfgB64 = b64(cfg.deployConfigYaml);
  const dockerfile = fs.readFileSync(DOCKERFILE, 'utf8').replace(/\r\n/g, '\n');

  say('Ensuring Docker is installed on the server...');
  const preflight = `
set -e
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker not found — installing via get.docker.com...'
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker version >/dev/null`;
  if (sshRun(cfg, preflight) !== 0) fail('Docker is not available on the server.');

  say(`Building image ${IMAGE} (node ${NODE_VERSION}) on ${cfg.user}@${cfg.host} (context-less)...`);
  let code = sshPipe(
    cfg,
    `DOCKER_BUILDKIT=1 docker build --build-arg NODE_VERSION=${NODE_VERSION} -t ${IMAGE} -`,
    dockerfile,
  );
  if (code !== 0) fail('Image build failed. See output above.');

  const runScript = `
set -euo pipefail
umask 077
SECRET_DIR=$(mktemp -d)
trap 'rm -rf -- "$SECRET_DIR"' EXIT
printf '%s' ${sq(keyB64)} | base64 -d > "$SECRET_DIR/id_ed25519"
printf '%s' ${sq(localYamlB64)} | base64 -d > "$SECRET_DIR/local.yaml"
printf '%s' ${sq(deployCfgB64)} | base64 -d > "$SECRET_DIR/config.yml"
echo 'Recreating container...'
docker rm -f ${CONTAINER} >/dev/null 2>&1 || true
mkdir -p ${sq(cfg.projectPath)}
# Host directory that persistently holds the app's runtime data cache (data-cache),
# bind-mounted over it so it survives container/volume removal.
mkdir -p ${sq(cfg.statePath)}
docker create --name ${CONTAINER} --restart unless-stopped \
  --privileged --cgroupns=host \
  --network host \
  --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v ${sq(cfg.projectPath)}:${cfg.projectPath} \
  -v ${sq(cfg.statePath)}:${cfg.projectPath}/${cfg.cacheDir} \
  -e REPO_URL=${sq(cfg.repoUrl)} \
  -e BRANCH=${sq(cfg.branch)} \
  -e PROJECT_DIR=${sq(cfg.projectPath)} \
  -e SERVICE_NAME=${sq(cfg.name)} \
  -e SERVICE_INSTANCE=${sq(cfg.instance)} \
  -e DEBUG=${sq(cfg.debug)} \
  -e PUBLIC_BASE_URL=${sq(cfg.publicUrl)} \
  -e APP_HOST=${sq(cfg.appHost)} \
  -e APP_PORT=${sq(cfg.appPort)} \
  ${IMAGE}
docker cp "$SECRET_DIR" ${CONTAINER}:/run-secrets
docker start ${CONTAINER}
echo 'Container started. First boot clones + builds inside the container (a few minutes).'
${cfg.reverseProxy ? reverseProxySnippet(cfg) : "echo 'Direct internal connection; nginx settings remain unchanged.'"}
`;
  say('Starting container and wiring up the reverse proxy (Caddy or nginx)...');
  code = sshRun(cfg, runScript);
  if (code !== 0) fail(`Deploy failed (exit ${code}). Run: node remote.cjs status`);
  say(`Done. First boot builds inside the container; watch it with: node remote.cjs status`);
  say(`Endpoint (once built): ${cfg.publicUrl}/health`);
}

function cmdDeploy(cfg) {
  return cfg.deploymentMode === 'docker' ? cmdDeployDocker(cfg) : cmdDeploySystemd(cfg);
}

function cmdStatusDocker(cfg) {
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  const lp = logPaths(cfg);
  const script = `
echo '===== CONTAINER ====='
docker ps -a --filter name=^/${CONTAINER}$ --format 'status: {{.Status}}' || true
echo "health: $(docker inspect -f '{{.State.Health.Status}}' ${CONTAINER} 2>/dev/null || echo n/a)"
echo
echo '===== APP SERVICE (inside container) ====='
docker exec ${CONTAINER} systemctl is-active ${SERVICE} 2>/dev/null || echo 'app service not active yet (may still be building)'
docker exec ${CONTAINER} test -f /var/lib/deploy-bootstrap-done 2>/dev/null && echo 'bootstrap: done' || echo 'bootstrap: still running (first-time clone/build)'
echo
echo '===== GIT (inside container) ====='
docker exec ${CONTAINER} bash -lc 'cd ${cfg.projectPath} 2>/dev/null && git log -1 --pretty="HEAD %h %ci %s"' 2>/dev/null || echo '(repo not cloned yet)'
echo
echo '===== HEALTH ====='
curl -fsS -m 5 "http://127.0.0.1:${cfg.appPort}/health" && echo || echo 'local /health FAILED'
curl -fsS -m 8 "${cfg.publicUrl}/health" && echo || echo 'external /health FAILED'
echo
echo '===== AUTO-UPDATE ====='
docker exec ${CONTAINER} cat /etc/cron.d/mcp-update 2>/dev/null || echo 'cron file not present yet'
echo -n 'last update verdict: '
docker exec ${CONTAINER} cat ${lp.status} 2>/dev/null || echo '(no update has run yet — cron checks every minute)'
ERRS=$(docker exec ${CONTAINER} grep -aF '[ERROR]' ${lp.lastDeploy} 2>/dev/null | wc -l | tr -d ' ')
if [ "\${ERRS:-0}" -gt 0 ] 2>/dev/null; then
  echo "⚠ \${ERRS} error line(s) in the last update run — details: node remote.cjs updatelog"
  docker exec ${CONTAINER} grep -aF '[ERROR]' ${lp.lastDeploy} 2>/dev/null | tail -4
else
  echo 'no errors flagged in the last update run'
fi
echo
echo '===== REVERSE PROXY ====='
if grep -qE "^\\s*${dnsEsc}\\s*\\{" /etc/caddy/Caddyfile 2>/dev/null; then
  echo 'Caddy block present'
elif [ -f /etc/nginx/sites-enabled/${cfg.dns}.conf ]; then
  echo -n 'nginx site present; TLS cert: '
  [ -d /etc/letsencrypt/live/${cfg.dns} ] && echo 'yes (HTTPS)' || echo 'NO (HTTP only — DNS/certbot pending)'
else
  echo 'no reverse-proxy config for this domain'
fi
`;
  say(`Diagnostics for ${cfg.dns}`);
  sshRun(cfg, script);
}

function cmdStatusSystemd(cfg) {
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  const lp = logPaths(cfg);
  const script = `
echo '===== DEPLOYMENT ====='
echo 'mode: systemd'
echo 'project: ${cfg.projectPath}'
echo 'state: ${cfg.statePath}'
echo
echo '===== APP SERVICE ====='
systemctl is-active ${SERVICE} || true
systemctl status ${SERVICE} --no-pager --lines=12 || true
echo
echo '===== GIT ====='
git -C ${sq(cfg.projectPath)} log -1 --pretty='HEAD %h %ci %s' 2>/dev/null || echo '(repo not cloned yet)'
echo
echo '===== HEALTH ====='
curl -fsS -m 5 "http://127.0.0.1:${cfg.appPort}/health" && echo || echo 'local /health FAILED'
curl -fsS -m 8 "${cfg.publicUrl}/health" && echo || echo 'external /health FAILED'
echo
echo '===== AUTO-UPDATE ====='
cat /etc/cron.d/mcp-update-${sanitizeName(cfg.name)} 2>/dev/null || echo 'cron file not present'
echo -n 'last update verdict: '
if [ -f ${lp.status} ]; then
  cat ${lp.status}
elif [ -f /tmp/mcp-update-${sanitizeName(cfg.name)}.log ]; then
  echo '(cron ran; no deployment verdict was created because no update was needed)'
else
  echo '(cron has not run yet)'
fi
echo
echo '===== RESTART ALIAS ====='
if command -v restart >/dev/null 2>&1; then
  restart ls 2>/dev/null | awk -v service=${sq(SERVICE)} '$2 == "->" && $3 == service { print $0 }'
else
  echo 'restart command not installed'
fi
echo
echo '===== REVERSE PROXY ====='
if grep -qE "^\\s*${dnsEsc}\\s*\\{" /etc/caddy/Caddyfile 2>/dev/null; then
  echo 'Caddy block present'
elif [ -f /etc/nginx/sites-enabled/${cfg.dns}.conf ]; then
  echo 'nginx site present'
else
  echo 'no reverse-proxy config for this domain'
fi
`;
  say(`Diagnostics for ${cfg.dns}`);
  sshRun(cfg, script);
}

function cmdStatus(cfg) {
  return cfg.deploymentMode === 'docker' ? cmdStatusDocker(cfg) : cmdStatusSystemd(cfg);
}

function healthScript(cfg) {
  const activeCheck =
    cfg.deploymentMode === 'docker'
      ? `docker exec ${CONTAINER} systemctl is-active --quiet ${SERVICE}`
      : `systemctl is-active --quiet ${SERVICE}`;
  const logs =
    cfg.deploymentMode === 'docker'
      ? `docker exec ${CONTAINER} journalctl -u ${SERVICE} -n 80 --no-pager`
      : `journalctl -u ${SERVICE} -n 80 --no-pager`;
  return `
for attempt in $(seq 1 30); do
  if ${activeCheck} &&
    curl -fsS --max-time 2 http://127.0.0.1:${cfg.appPort}/health >/dev/null; then
    echo 'Application ready'; exit 0
  fi
  sleep 1
done
${logs}
exit 1`;
}

function cmdStop(cfg) {
  if (cfg.deploymentMode === 'systemd') {
    say(`Stopping systemd service ${SERVICE}`);
    return sshRun(cfg, `systemctl stop ${SERVICE} && echo stopped`);
  }
  say('Stopping container (auto-update stops with it)');
  sshRun(cfg, `docker stop ${CONTAINER} && echo stopped`);
}

function cmdStart(cfg) {
  if (cfg.deploymentMode === 'systemd') {
    say(`Starting systemd service ${SERVICE}`);
    return sshRun(cfg, `systemctl start ${SERVICE} && ${healthScript(cfg)}`);
  }
  say('Starting container');
  sshRun(cfg, `docker start ${CONTAINER} && ${healthScript(cfg)}`);
}

function cmdRestart(cfg) {
  if (cfg.deploymentMode === 'systemd') {
    say(`Restarting systemd service ${SERVICE}`);
    return sshRun(cfg, `systemctl restart ${SERVICE} && ${healthScript(cfg)}`);
  }
  say('Restarting the app service inside the container (no rebuild)');
  sshRun(cfg, `docker exec ${CONTAINER} systemctl restart ${SERVICE} && ${healthScript(cfg)}`);
}

function cmdUpdate(cfg) {
  if (cfg.deploymentMode === 'systemd') {
    say('Forcing update.cjs --force in the host project checkout');
    return sshRun(cfg, `cd ${sq(cfg.projectPath)} && ${NODE_BIN} update.cjs --force`);
  }
  say('Forcing update.cjs --force inside the container');
  sshRun(cfg, `docker exec ${CONTAINER} ${NODE_BIN} ${cfg.projectPath}/update.cjs --force`);
}

// Push selected installation files without changing Git or rebuilding the image.
// Bootstrap only writes them on first boot; later container restarts preserve them.
function cmdPushConfig(cfg, args) {
  const restartContainer = args.includes('--container');
  const noRestart = args.includes('--no-restart');
  if (restartContainer && noRestart) fail('Use either --container or --no-restart, not both.');
  if (restartContainer && cfg.deploymentMode === 'systemd') fail('--container is available only in docker mode.');

  const inner = `
set -euo pipefail
umask 077
cd ${sq(cfg.projectPath)}
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
printf '%s' ${sq(b64(cfg.localYaml))} | base64 -d > "$TMP/local.yaml"
printf '%s' ${sq(b64(cfg.deployConfigYaml))} | base64 -d > "$TMP/config.yml"
mkdir -p config deploy
if cmp -s "$TMP/local.yaml" config/local.yaml && cmp -s "$TMP/config.yml" deploy/config.yml; then
  chmod 600 config/local.yaml deploy/config.yml
  echo 'Configuration unchanged'; exit 10
fi
install -m 600 "$TMP/local.yaml" config/local.yaml
install -m 600 "$TMP/config.yml" deploy/config.yml
echo 'Configuration updated'`;
  const upload = cfg.deploymentMode === 'docker' ? `
set -euo pipefail
docker exec ${CONTAINER} test -f /var/lib/deploy-bootstrap-done
# Send file contents through stdin, never through process arguments.
docker exec -i ${CONTAINER} bash -s <<'MCP_CONFIG_INPUT'
${inner}
MCP_CONFIG_INPUT
` : inner;
  const code = sshRun(cfg, upload);
  if (code === 10) {
    process.exitCode = 0;
    return;
  }
  if (code !== 0) fail('Configuration upload failed');
  if (!noRestart) {
    const command = cfg.deploymentMode === 'systemd'
      ? `systemctl restart ${SERVICE}`
      : restartContainer
        ? `docker restart ${CONTAINER}`
        : `docker exec ${CONTAINER} systemctl restart ${SERVICE}`;
    sshRun(cfg, `${command} && ${healthScript(cfg)}`);
  }
  say('If webServer.port changed, run deploy to update the runtime and reverse proxy.');
}

function cmdLogs(cfg, n) {
  const lines = /^\d+$/.test(String(n)) ? n : '200';
  say(`Last ${lines} app-service log lines`);
  const prefix = cfg.deploymentMode === 'docker' ? `docker exec ${CONTAINER} ` : '';
  sshRun(cfg, `${prefix}journalctl -o cat --no-pager -n ${lines} -u ${SERVICE}`);
}

function cmdBootlog(cfg, n) {
  const lines = /^\d+$/.test(String(n)) ? n : '200';
  if (cfg.deploymentMode === 'systemd') {
    say(`Systemd mode has no separate bootstrap unit; showing the last ${lines} application log lines`);
    return sshRun(cfg, `journalctl -o cat --no-pager -n ${lines} -u ${SERVICE}`);
  }
  say(`Last ${lines} bootstrap (clone/build) log lines`);
  sshRun(cfg, `docker exec ${CONTAINER} journalctl -o cat --no-pager -n ${lines} -u mcp-bootstrap.service`);
}

// Inspect the auto-update history: the last verdict, the full last-update run log,
// and every error line — so a failed rebuild is easy to spot and diagnose.
function cmdUpdatelog(cfg, n) {
  const lines = /^\d+$/.test(String(n)) ? n : '80';
  const lp = logPaths(cfg);
  const readPrefix = cfg.deploymentMode === 'docker' ? `docker exec ${CONTAINER} ` : '';
  const script = `
echo '===== LAST UPDATE VERDICT ====='
${readPrefix}cat ${lp.status} 2>/dev/null || echo '(no update has run yet — cron checks every minute)'
echo
echo '===== ERROR LINES (last run + history) ====='
{ ${readPrefix}grep -aF '[ERROR]' ${lp.lastDeploy} 2>/dev/null;
  ${readPrefix}grep -aF '[ERROR]' ${lp.cumulative} 2>/dev/null; } | tail -20
${readPrefix}sh -c "grep -aqF '[ERROR]' ${lp.lastDeploy} ${lp.cumulative} 2>/dev/null" && true || echo '(no [ERROR] entries found)'
echo
echo '===== LAST UPDATE RUN LOG (tail ${lines}) ====='
${readPrefix}tail -n ${lines} ${lp.lastDeploy} 2>/dev/null || echo '(no completed update run recorded yet)'
${cfg.deploymentMode === 'systemd' ? `
echo
echo '===== HOST CRON OUTPUT ====='
tail -n ${lines} /tmp/mcp-update-${sanitizeName(cfg.name)}.log 2>/dev/null || echo '(cron has not run yet)'` : ''}
`;
  say('Auto-update log and error scan');
  sshRun(cfg, script);
}

// Open an interactive shell inside the container (for debugging/testing).
function cmdShell(cfg) {
  if (cfg.deploymentMode === 'systemd') {
    say(`Opening a shell in ${cfg.projectPath} (exit to leave)`);
    return sshRun(cfg, `cd ${sq(cfg.projectPath)} && exec bash -l`, { interactive: true });
  }
  say('Opening an interactive shell inside the container (exit to leave)');
  sshRun(cfg, `docker exec -it ${CONTAINER} bash -l`, { interactive: true });
}

// Run an arbitrary command inside the container: `node remote.cjs exec -- <cmd...>`.
function cmdExec(cfg, args) {
  const idx = args.indexOf('--');
  const parts = idx >= 0 ? args.slice(idx + 1) : args;
  if (!parts.length) fail('Usage: node remote.cjs exec -- <command...>');
  const inner = parts.join(' ');
  if (cfg.deploymentMode === 'systemd') {
    say(`Running in the host project checkout: ${inner}`);
    return sshRun(cfg, `cd ${sq(cfg.projectPath)} && bash -lc ${sq(inner)}`);
  }
  say(`Running in container: ${inner}`);
  sshRun(cfg, `docker exec ${CONTAINER} bash -lc ${sq(inner)}`);
}

function reverseProxyRemovalScript(cfg) {
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  return `
echo 'Removing Caddy block for ${cfg.dns}...'
CF=/etc/caddy/Caddyfile
if [ -f "$CF" ] && grep -qE "^\\s*${dnsEsc}\\s*\\{" "$CF"; then
  BAK="$CF.bak.$(date +%s)"; cp "$CF" "$BAK"
  awk 'BEGIN{skip=0}
    /^[[:space:]]*${dnsEsc}[[:space:]]*\\{/{skip=1; next}
    skip==1 && /^\\}/{skip=0; next}
    skip==0{print}
  ' "$BAK" > "$CF"
  caddy validate --adapter caddyfile --config "$CF" >/dev/null 2>&1 && systemctl reload caddy && echo 'Caddy block removed.' \
    || { cp "$BAK" "$CF"; echo 'Caddy validation failed — restored from backup.'; }
fi
echo 'Removing nginx site for ${cfg.dns} (if any)...'
if [ -f /etc/nginx/sites-available/${cfg.dns}.conf ] || [ -L /etc/nginx/sites-enabled/${cfg.dns}.conf ]; then
  rm -f /etc/nginx/sites-enabled/${cfg.dns}.conf /etc/nginx/sites-available/${cfg.dns}.conf
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo 'nginx site removed.' || echo 'nginx reload skipped.'
fi
echo 'Note: an existing TLS certificate is left in place.'`;
}

function validateUninstallPaths(cfg, preserveState) {
  const projectPath = cfg.projectPath.replace(/\/+$/, '') || '/';
  const statePath = cfg.statePath.replace(/\/+$/, '') || '/';
  const protectedPaths = new Set(['/', '/opt', '/opt/node', '/var', '/var/opt', '/var/opt/node']);
  if (protectedPaths.has(projectPath) || projectPath.split('/').filter(Boolean).length < 3) {
    fail(`Refusing to remove unsafe project.projectPath: ${projectPath}`);
  }
  if (preserveState && (statePath === projectPath || statePath.startsWith(`${projectPath}/`))) {
    fail(`Refusing to remove project.projectPath because project.statePath is inside it: ${statePath}`);
  }
  return { projectPath, statePath };
}

function cmdUninstallSystemd(cfg, yes) {
  if (!yes) fail('Destructive. Re-run with --yes to remove the systemd service and project checkout.');
  const { projectPath, statePath } = validateUninstallPaths(cfg, false);
  const script = `
set -euo pipefail
PROJECT_PATH=${sq(projectPath)}
STATE_PATH=${sq(statePath)}
if [ -L "$PROJECT_PATH" ]; then
  echo "Refusing to remove symbolic-link project path: $PROJECT_PATH" >&2; exit 1
fi
if [ -e "$PROJECT_PATH" ] && [ "$(readlink -f -- "$PROJECT_PATH")" != "$PROJECT_PATH" ]; then
  echo 'Refusing to remove project path with an unexpected resolved path' >&2; exit 1
fi
if command -v restart >/dev/null 2>&1; then
  while IFS= read -r ALIAS; do
    [ -n "$ALIAS" ] && restart del "$ALIAS"
  done < <(restart ls 2>/dev/null | awk -v service=${sq(SERVICE)} '$2 == "->" && $3 == service { print $1 }')
fi
systemctl disable --now ${SERVICE} 2>/dev/null || true
rm -f /etc/systemd/system/${SERVICE}.service
systemctl daemon-reload
rm -f /etc/cron.d/mcp-update-${sanitizeName(cfg.name)}
rm -f "$HOME/.ssh/${cfg.name}-deploy"
rm -rf -- "$PROJECT_PATH"
[ ! -e "$PROJECT_PATH" ] || { echo "Project path still exists: $PROJECT_PATH" >&2; exit 1; }
echo "Removed systemd state with project path: $STATE_PATH"
${reverseProxyRemovalScript(cfg)}
echo 'Done.'
`;
  say(`Uninstalling systemd service ${SERVICE} from the server`);
  sshRun(cfg, script);
}

function cmdUninstallDocker(cfg, yes) {
  if (!yes) fail('Destructive. Re-run with --yes to remove the container, image and project checkout.');
  const { projectPath, statePath } = validateUninstallPaths(cfg, true);
  const script = `
set -euo pipefail
PROJECT_PATH=${sq(projectPath)}
STATE_PATH=${sq(statePath)}
IMAGE_ID=$(docker image inspect --format '{{.Id}}' ${IMAGE} 2>/dev/null || true)
TARGET_CONTAINER_ID=$(docker inspect --format '{{.Id}}' ${CONTAINER} 2>/dev/null || true)
if [ -L "$PROJECT_PATH" ]; then
  echo "Refusing to remove symbolic-link project path: $PROJECT_PATH" >&2; exit 1
fi
while IFS= read -r ID; do
  [ -n "$ID" ] || continue
  [ "$ID" = "$TARGET_CONTAINER_ID" ] && continue
  NAME=$(docker inspect --format '{{.Name}}' "$ID" | sed 's#^/##')
  USED_IMAGE=$(docker inspect --format '{{.Image}}' "$ID")
  if [ -n "$IMAGE_ID" ] && [ "$USED_IMAGE" = "$IMAGE_ID" ]; then
    echo "Refusing to remove image used by container: $NAME" >&2; exit 1
  fi
  if docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' "$ID" | grep -Fxq "$PROJECT_PATH"; then
    echo "Refusing to remove project path used by container: $NAME" >&2; exit 1
  fi
done < <(docker ps -aq)
[ -z "$TARGET_CONTAINER_ID" ] || docker rm -f ${CONTAINER}
if [ -n "$IMAGE_ID" ]; then docker rmi -f "$IMAGE_ID"; fi
rm -rf -- "$PROJECT_PATH"
[ ! -e "$PROJECT_PATH" ] || { echo "Project path still exists: $PROJECT_PATH" >&2; exit 1; }
echo "Preserved state path: $STATE_PATH"
${reverseProxyRemovalScript(cfg)}
echo 'Done.'
`;
  say(`Uninstalling Docker deployment ${cfg.name} from the server`);
  sshRun(cfg, script);
}

function cmdUninstall(cfg, yes) {
  return cfg.deploymentMode === 'docker' ? cmdUninstallDocker(cfg, yes) : cmdUninstallSystemd(cfg, yes);
}

function cmdSsh(cfg) {
  console.log(`ssh ${sshBaseArgs(cfg).join(' ')}`);
}

// ── Entry point ──────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv[0] === 'help') {
    console.log(
      'node remote.cjs --server <alias> <show|keygen|deploy|status|start|stop|restart|update|push-config|logs|bootlog|updatelog|shell|exec|uninstall|ssh>',
    );
    return;
  }
  const selected = selectServer(argv);
  const [cmd, ...rest] = selected.rest;
  const cfg = loadConfig(selected.alias);
  // Resolve all project-specific names from the config once.
  CONTAINER = cfg.name;
  IMAGE = `${cfg.name}:latest`;
  SERVICE = `${cfg.name}--${cfg.instance}`;
  UPSTREAM = `${cfg.name.replace(/[^a-z0-9]/gi, '_')}_upstream`;
  NODE_VERSION = cfg.nodeVersion;
  say(
    `Target: ${cfg.alias}; mode: ${cfg.deploymentMode}; host: ${cfg.host}; project: ${cfg.projectPath}; branch: ${cfg.branch}`,
  );
  switch (cmd) {
    case 'show':
      console.log(
        JSON.stringify(
          {
            server: cfg.alias,
            deploymentMode: cfg.deploymentMode,
            host: cfg.host,
            ...(cfg.deploymentMode === 'docker' ? { container: CONTAINER } : {}),
            projectPath: cfg.projectPath,
            statePath: cfg.statePath,
            branch: cfg.branch,
            service: SERVICE,
            restartAliasCandidate: cfg.restartAliasCandidates[0],
            port: cfg.appPort,
            domain: cfg.dns,
          },
          null,
          2,
        ),
      );
      return;
    case 'keygen':
      return cmdKeygen(cfg);
    case 'deploy':
      return cmdDeploy(cfg);
    case 'status':
      return cmdStatus(cfg);
    case 'stop':
      return cmdStop(cfg);
    case 'start':
      return cmdStart(cfg);
    case 'restart':
      return cmdRestart(cfg);
    case 'push-config':
    case 'config':
      return cmdPushConfig(cfg, rest);
    case 'update':
      return cmdUpdate(cfg);
    case 'logs':
      return cmdLogs(cfg, rest[0]);
    case 'bootlog':
      return cmdBootlog(cfg, rest[0]);
    case 'updatelog':
      return cmdUpdatelog(cfg, rest[0]);
    case 'shell':
      return cmdShell(cfg);
    case 'exec':
      return cmdExec(cfg, rest);
    case 'uninstall':
      return cmdUninstall(cfg, rest.includes('--yes'));
    case 'ssh':
      return cmdSsh(cfg);
    default:
      console.log(`MCP deploy orchestrator (${cfg.name}) — subcommands:
  keygen            Create a read-only GitHub Deploy Key and print the public part
  deploy            Deploy using deployment.mode (systemd by default, docker when selected)
  status            Diagnostics: runtime, app service, git, health, cron and proxy
  stop              Stop the configured service runtime
  start             Start the configured service runtime
  restart           Restart just the app service (fast, no rebuild)
  push-config       Generate and deliver application/update settings, then restart
                      [--container] restart the whole container instead of the app service
                      [--no-restart] push only, restart later
  update            Force update.cjs --force in the configured runtime
  logs [N]          Last N app-service journal lines (default 200)
  bootlog [N]       Last N bootstrap (clone/build) journal lines (default 200)
  updatelog [N]     Last auto-update verdict + error scan + last-run log (default 80)
  shell             Open an interactive shell in the project runtime
  exec -- <cmd...>  Run a command in the project runtime
  uninstall --yes   Remove runtime and project checkout; preserve statePath
  ssh               Print the raw ssh command for manual access`);
      if (cmd && cmd !== 'help') process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { selectServer, loadConfig, parseYaml, restartAliasCandidates };
