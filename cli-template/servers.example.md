# Deployment Names

Copy this file to `servers.local.md` if additional server names are needed. The actual registry is not stored in Git.
Each row must unambiguously identify a configuration directory; do not add secrets to the registry.

| Directory name / server alias | Additional names | Configuration and notes |
|---|---|---|
| dev-1 | first test server | `.agents/skills/deploy/configs/dev-1/` |
| prod-2 | second production server | `.agents/skills/deploy/configs/prod-2/` |

This is only an example: these directories are not created automatically and do not represent available deployments.
