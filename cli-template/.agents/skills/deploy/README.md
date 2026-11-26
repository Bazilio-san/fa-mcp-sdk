# Deployment internals and diagnostics

See [SKILL.md](SKILL.md) for target selection, settings and commands. Run commands from the project root with an
explicit `--server <alias>`. Real settings live in `configs/<alias>/`; the template lives in `configs/_example/`.

## Runtime and data

`deployment.mode` selects `systemd` or `docker`; `systemd` is the default. Systemd mode clones the repository into
the host's `project.projectPath`, installs the unit through `deploy/srv.cjs` and runs updates from host cron. Docker
mode builds the Ubuntu image and runs systemd inside a privileged container with host networking.

In systemd mode, `project.cacheDir` is a real directory inside the checkout, never a symbolic link. Its state is
removed with `project.projectPath` during uninstall. Docker mode bind-mounts a separate `project.statePath`, whose
default is `/opt/<installation-name>` and which uninstall deliberately preserves.

When migrating to systemd, copy key files into the real `<projectPath>/<cacheDir>` directory before starting the
service, do not remove the source, and verify filenames and sizes without printing contents. Never use a symbolic
link and never overwrite different destination keys.

The private key and settings are sent through SSH standard input into a temporary directory and installed with mode
`0600`. `config.yaml` supplies connection and deployment settings. Its `update` section and `project.branch`
generate `deploy/config.yml`; `local.yaml` becomes the application's `config/local.yaml`.

If the host has the `restart` utility, deployment registers an alias after the unit exists. The first candidate is
formed from the initials of the service-name words; collisions extend the final word before using a numeric suffix.

## Status checks

```bash
node .agents/skills/deploy/scripts/remote.cjs --server dev-1 status
node .agents/skills/deploy/scripts/remote.cjs --server dev-1 bootlog 200
node .agents/skills/deploy/scripts/remote.cjs --server dev-1 logs 200
node .agents/skills/deploy/scripts/remote.cjs --server dev-1 updatelog 80
```

Wait for the initial build to complete. If local `/health` works but public access fails, check the domain,
certificate and Caddy or nginx settings. Do not add duplicate security headers: the application already provides
them. For stalled MCP streams, check disabled buffering and long timeouts in the reverse proxy configuration.

Verify `/`, `/admin` and `/agent-tester` with external HTTP requests. Verify `/mcp` with a short-lived credential and
an MCP client; an unauthenticated 401 response is expected when authentication is enabled and is not a complete
protocol test. Also run the registered `restart` alias once and wait for `/health` to recover.

## Retrying updates

Root `update.js` uses `flock` to prevent concurrent runs. Pending state lives in `.git/deploy-update-pending.json`,
so working-tree cleanup does not remove it. A retry runs the required dependency installation and build steps,
restarts the service and waits for readiness. Failures return a nonzero exit code. There is no automatic rollback;
inspect the last deployment log to identify and fix the cause.

Every completed repository check writes `deploy__<project-folder>__check_status.log` beside the project directory,
including successful checks with no changes. `deploy__<project-folder>__status.log` records the last attempted
deployment independently; an old deployment failure is historical when a newer repository check has succeeded.
`status` and `updatelog` display both results. A build failure leaves the successful repository check intact.

Temporary Git connection failures receive up to three retries after the initial attempt, with delays of 2, 4 and
8 seconds. Authentication, host-key and missing-repository or branch errors fail immediately. The original failure
is retained after retries are exhausted; dependency installation and service restart are never retried this way.

Manual updates in systemd mode load NVM when installed and use the Node.js version configured for the installation.
The updater uses `npm ci` and `npm run cb` when the updated checkout contains `package-lock.json`. Projects without
that file use Yarn for dependency installation and the TypeScript build.

When upgrading an existing installation, use the updated `remote.cjs --server <alias> update` command: it accepts
the old entry-point filename and migrates the selected cron entry once `update.js` exists, even if its build fails.
The update command preserves the failure exit code so the pending update can be retried by cron. `deploy`
also recreates the cron entry. Renaming the repository file alone does not change an existing system cron file.

Run the isolated regression suite with `npm run test:update`. It exercises the actual entry point with intercepted
system commands, including unchanged code, recovered and exhausted connections, access failures and build outcomes.

`restart` only restarts the application; `update` synchronizes code. Port or runtime changes require `deploy`.
After any change, also check public access with `status`.
