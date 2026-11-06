---
name: deploy-mcp-to-remote-server
description: >-
  Deploy, update, start, stop and diagnose named MCP server installations using host systemd by default or Docker
  when configured. Use for requests such as "deploy to dev-1", "update prod-2", or inspect status and logs.
allowed-tools: Bash, Read
---

# Deploy an MCP server

## Select an installation

Work from the project root. If `servers.local.md` exists there, read it and resolve the requested name to an
installation folder. Read that folder's `configs/<alias>/rules.md` and settings without printing secrets. Read any
machine description referenced by the rules. The folder name itself is also a valid installation name. If the
request is ambiguous, ask for the target; never select a similar name, the first server or a default environment.

Pass `--server <alias>` explicitly to every command. The alias identifies a folder; resolve conversational names
through the registry. Do not interpret `dev` as the local workstation. `_example` is not a deployment target.

```bash
node .agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs --server dev-1 show
node .agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs --server dev-1 deploy
```

Before making changes, run `show`: it prints the selected host, mode, branch, paths, service, port and domain without
secrets. Compare them with the request and installation rules. Use `remote.cjs` for supported operations.

## Installation settings

Copy `configs/_example/` to `configs/<alias>/`. Use lowercase Latin letters, digits, dots, hyphens and underscores;
start with a letter or digit. Select `deployment.mode: systemd|docker`; omitted mode means `systemd`. Each
installation folder contains these files:

- `config.yaml`: connection, repository, deployment mode, domain, persistent data and the `update` section.
- `local.yaml`: application settings, copied verbatim to the application's `config/local.yaml`.
- `rules.md`: installation, networking and recovery requirements. Keep additional reference files alongside it.

Ask only for missing values. Real installation folders and root `servers.local.md` are excluded from Git; transfer
them separately to a new workstation. The optional registry format is shown in root `servers.example.md`.

To migrate old settings, rename `remote-server-config.local.yaml` to `config.yaml`. Move `branch` from the separate
`config.yml` to `project.branch`, move its remaining fields under `update` in `config.yaml`, then delete `config.yml`.
Move `local.yaml` to the named folder, add `rules.md`, and preserve the previous `service.name`, `service.instance`,
`project.projectPath` and `project.statePath` so commands continue managing the existing service and data.

By default, runtime and service names include the project name and installation alias. Installations sharing a host
also need different ports and domains. An explicit `service.name` must be unique. Node.js comes from `.envrc` or
`container.nodeVersion`.

Systemd mode clones the repository into `project.projectPath`, installs a host service and keeps state directly in
the real `project.cacheDir` directory; it must not create a symbolic link. In this mode, `project.statePath` is
invalid and uninstall removes the state together with the project checkout. Docker mode bind-mounts a separate
`project.statePath`, defaulting to `/opt/<installation-name>`, and preserves it during uninstall. With
`mcp.reverseProxy: false`, the service uses direct HTTP at `mcp.dns:webServer.port` and leaves nginx/Caddy unchanged.

After installing a systemd service, if `restart` exists, register an alias with `restart add`. Build the base alias
from the initials of words obtained by replacing non-alphanumeric characters with spaces. If occupied, append
successive characters of the final word; after exhausting it, append a number. Reuse an existing alias that already
points to the service and never trigger the command's interactive overwrite prompt.

When moving an installation to systemd, copy its key directory into `project.projectPath/project.cacheDir` before
starting the service. Keep the old state directory, refuse to overwrite different destination keys, and verify
filenames and sizes without printing key contents. Copy means a real directory and files, never a symbolic link.

## Commands

| Action | Command after `--server <alias>` |
|---|---|
| Show the selected installation without connecting | `show` |
| Generate a read-only repository key | `keygen` |
| Deploy using the configured mode and configure networking | `deploy` |
| Check runtime, service, version, local and public `/health` | `status` |
| Stop or start the configured service | `stop`, `start` |
| Restart the application without updating code | `restart` |
| Apply an update and check readiness | `update` |
| Deliver settings and restart the application | `push-config` |
| Deliver settings only, or restart a Docker container | `push-config --no-restart`, `push-config --container` |
| Read application, initial boot or update logs | `logs 200`, `bootlog 200`, `updatelog 80` |
| Open a shell or run a command in the configured runtime | `shell`, `exec -- <command>` |
| Print the SSH connection command | `ssh` |
| Remove the runtime, `projectPath` and reverse proxy; preserve Docker `statePath` | `uninstall --yes` |

Uninstall only when explicitly requested. It permanently removes `project.projectPath`, including systemd mode's
in-project state; Docker mode preserves its separate `project.statePath`. It must refuse broad paths, symbolic links,
nested Docker state paths and resources used by another container. After `deploy`, check `status` until the service
and readiness endpoint both succeed.

`push-config` does not update code. Changes to the application port, connection or container settings require
`deploy`. Initial secrets are delivered as private files and removed from temporary storage after successful
installation. Never print settings contents.

## Updates and diagnostics

Set the branch in `project.branch` and notifications in `update.email`, `update.smtp` and `update.telegram`.
The runtime's `deploy/config.yml` is generated automatically from these settings and `update.healthUrl`.

Root `update.cjs` runs manually or every minute from cron on the host or inside the container. A lock prevents
concurrent runs. Before code changes, a pending-update marker is saved inside `.git`; it is removed after the
readiness check. On failure, the next run retries the required steps. This does not automatically roll back.

After an update, the application must return 2xx from `update.healthUrl` or local `/health` on its listening port.
Otherwise, the command fails, retains the marker and shows service logs. Check public access separately using
`status`: application failures and Caddy or nginx failures may have different causes.

After deployment, verify the externally configured base URL: `/`, `/admin` and `/agent-tester` must return HTML
successfully. A protected `/mcp` returning 401 without credentials only proves authentication is enabled; issue a
short-lived token and run a real MCP discovery or tool-list request through the external URL. Do not call business
tools, send messages or invoke a model merely to verify transport availability.

Report the selected installation, deployment mode, actual version, application state, public URL and unfinished
steps. Consult [README.md](README.md) for runtime internals and diagnostics. Docker mode uses systemd,
`--privileged` and host networking; systemd mode runs directly on the host.
