# Deployment internals and diagnostics

See [SKILL.md](SKILL.md) for target selection, settings and commands. Run commands from the project root with an
explicit `--server <alias>`. Real settings live in `configs/<alias>/`; the template lives in `configs/_example/`.

## Container and data

The Ubuntu image contains Node.js and systemd. Application sources are cloned on first boot. The container uses
host networking, `--privileged` and a cgroup mount; the application listens only on `127.0.0.1` at its configured
port. Caddy or nginx provides public access and TLS. Preserve disabled buffering and long response timeouts from
the project's `deploy/` templates for streaming MCP responses.

The working copy and dependencies live in a named Docker volume. Persistent application data is mounted from
`project.statePath` on the host into `project.cacheDir` inside the project. `uninstall --yes` removes the container,
image, named volume and any host directory at `project.projectPath`, but deliberately preserves
`project.statePath`. Container, image, volume and path defaults include the installation alias. When migrating an
existing deployment, set its previous `service.name` and paths explicitly; renaming a folder does not automatically
move data.

The private key and settings are sent through SSH standard input into a private temporary directory. Before the
container starts, files are copied to `/run-secrets`. Bootstrap installs the key and settings with mode `0600`;
after successful setup, temporary files are removed. On initial boot failure, files remain inside the container
for a retry. Secrets are not stored in Docker environment variables.

`config.yaml` supplies connection and deployment settings. Its `update` section and `project.branch` generate the
container's `deploy/config.yml`; connection settings and workstation key paths are not included in that file.
`local.yaml` is delivered verbatim as the application's `config/local.yaml`.

`push-config` sends files directly into the container through standard input. Temporary copies are removed when
the command finishes, including failures. Sending identical settings again does not trigger a restart.

## Status checks

```bash
node .agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs --server dev-1 status
node .agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs --server dev-1 bootlog 200
node .agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs --server dev-1 logs 200
node .agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs --server dev-1 updatelog 80
```

Wait for the initial build to complete. If local `/health` works but public access fails, check the domain,
certificate and Caddy or nginx settings. Do not add duplicate security headers: the application already provides
them. For stalled MCP streams, check disabled buffering and long timeouts in the reverse proxy configuration.

## Retrying updates

Root `update.cjs` uses `flock` to prevent concurrent runs. Pending state lives in `.git/deploy-update-pending.json`,
so working-tree cleanup does not remove it. A retry runs the required dependency installation and build steps,
restarts the service and waits for readiness. Failures return a nonzero exit code. There is no automatic rollback;
inspect the last deployment log to identify and fix the cause.

`restart` only restarts the application; `update` synchronizes code. Port or container changes require `deploy`.
After any change, also check public access with `status`.
