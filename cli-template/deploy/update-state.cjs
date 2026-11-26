const fs = require('node:fs');
const path = require('node:path');

function classifyChanges(files) {
  const dependencies = files.some(
    (file) =>
      /^(package\.json|yarn\.lock|package-lock\.json|\.yarnrc.*|\.npmrc)$/.test(file) ||
      /^(patches\/|scripts\/patch_node_modules)/.test(file),
  );
  // Unknown inputs conservatively require a build; only documentation is excluded.
  const build = dependencies || files.some((file) => !/\.md$/i.test(file));
  return { dependencies, build };
}
function readPending(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof value.dependencies !== 'boolean' || typeof value.build !== 'boolean') throw new Error('Invalid state');
    return value;
  } catch {
    return { dependencies: true, build: true };
  }
}
function writePending(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
async function waitForHealth(url, { attempts = 30, delay = 1000, fetcher = fetch } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 300) return;
    } catch {
      /* The service may still be starting. */
    }
    if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error('Application health check failed');
}
function writeCheckStatus(file, status, detail) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  fs.writeFileSync(`${file}.tmp`, `${status} | ${timestamp}Z | ${String(detail).replace(/[\r\n]+/g, ' ')}\n`, {
    mode: 0o600,
  });
  fs.renameSync(`${file}.tmp`, file);
}

async function fetchWithRetry(
  run,
  { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onRetry = () => {} } = {},
) {
  const delays = [2000, 4000, 8000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const message = `${error.stderr ?? ''}\n${error.message ?? ''}`;
      const permanent = [
        /Permission denied|Authentication failed|Host key verification failed/i,
        /Repository not found|repository .* not found|couldn't find remote ref|access denied/i,
      ].some((pattern) => pattern.test(message));
      const temporary = [
        /kex_exchange_identification|Connection (?:reset|closed|timed out|refused)|Operation timed out/i,
        /Could not resolve (?:host|hostname|proxy)|Temporary failure in name resolution/i,
        /Network is unreachable|No route to host|remote end hung up|unexpected disconnect/i,
        /TLS connection was non-properly terminated|SSL_ERROR_SYSCALL|requested URL returned error: (?:429|5\d\d)/i,
      ].some((pattern) => pattern.test(message));
      if (attempt >= delays.length || permanent || !temporary) {
        throw error;
      }
      onRetry(attempt + 1, delays[attempt]);
      await sleep(delays[attempt]);
    }
  }
}

module.exports = { classifyChanges, readPending, writePending, waitForHealth, writeCheckStatus, fetchWithRetry };
