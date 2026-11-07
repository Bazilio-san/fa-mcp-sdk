---
name: deploy-new-project
description: Deploy a new fa-mcp-sdk project from a configuration file, verifying its build and startup.
---

# Deploy a New Project

Read the repository instructions, README.md, and sections 03 and 07 in `cli-template/FA-MCP-SDK-DOC/`.
Obtain the generator configuration file path and check `projectAbsPath`, the port, and the server address.
Do not print configuration secrets or include them in Git history or the skill text.

Install the published version with `npm install -g fa-mcp-sdk@latest` and verify it using
`npm list -g fa-mcp-sdk --depth=0`. Create the project with `fa-mcp <config-path>`.
Do not delete an existing directory containing user changes without permission. Before an authorized deletion,
verify the absolute path and the absence of links to unrelated dependencies. In PowerShell, use
`Remove-Item -LiteralPath`.

In the new project, run `npm install`, `npm run cb`, `npm run lint`, and `npm run format`.
Run `npm start`, check `/health` and `/ready`, and send an MCP request using a client from the installed package.
Record the addresses actually checked, the version, results, and how the process was stopped.
Do not present a local startup check as verification that the remote server is reachable.

## Direct HTTP Access Within the Network

A separate domain name and Nginx are not required for direct port access. In `config/local.yaml`, set
`webServer.host: '0.0.0.0'`, the required `webServer.port`, and `http://<server>:<port>` in `swagger.servers`.
Add the server name to `webServer.originHosts`, preserving the necessary local names. Verify the actual behavior of
the Origin check. Allow inbound connections to the port through the server's network security controls.
Do not apply the generated HTTPS Nginx example to this deployment without configuring it separately.
An Nginx file rename warning caused by a colon in `mcp.domain` on Windows does not by itself prove that HTTP startup
failed; verify the build and requests to the running process.

## Fixes

Fix configuration errors in the new project's `config/local.yaml`. Request missing credentials if they are needed
to start or verify a required feature. Do not replace verification by disabling the feature.
For a library error, fix the SDK sources and run lint, format, typecheck, and build in its repository.
If the user has authorized pushing and publishing, commit the fix, push it to GitHub, publish the package, and repeat
generation using the published version. Otherwise, request permission for the specific prepared publication.
Deleting the project again is allowed only within the user's authorization and after inspecting its contents.
If the same cause recurs without progress, stop retrying, investigate the logs, and report the blocker.
