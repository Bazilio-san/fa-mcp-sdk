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
module.exports = { classifyChanges, readPending, writePending, waitForHealth };
