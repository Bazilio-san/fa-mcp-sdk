/*
 Minimal prebuild script: only pins cli-template fa-mcp-sdk dependency to current SDK version
*/

const path = require('path');
const fss = require('fs');
const fs = require('fs/promises');


(async () => {
  try {
    const PROJ_ROOT = path.resolve(__dirname, '..');

    const pjContent = fss.readFileSync(path.join(PROJ_ROOT, 'package.json'));
    const faMcpSdkVersion = JSON.parse(pjContent).version;
    const templatePkgPath = path.join(PROJ_ROOT, 'cli-template', 'package.json');
    const content = await fs.readFile(templatePkgPath, 'utf8');
    const packageJson = JSON.parse(content);

    // Pin dependency to current SDK version
    if (!packageJson.dependencies) packageJson.dependencies = {};
    packageJson.dependencies['fa-mcp-sdk'] = `^${faMcpSdkVersion}`;

    const updated = JSON.stringify(packageJson, null, 2) + '\n';
    if (updated !== content) {
      await fs.writeFile(templatePkgPath, updated, 'utf8');
      console.log(`prebuild: pinned fa-mcp-sdk version in cli-template/package.json to ${faMcpSdkVersion}`);
    } else {
      console.log(`prebuild: fa-mcp-sdk version in cli-template/package.json already up-to-date (${faMcpSdkVersion})`);
    }
  } catch (err) {
    console.error('prebuild error:', err && err.message ? err.message : err);
    process.exitCode = 1;
  }
})();
