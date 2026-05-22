# GitLab Runner Setup

Docker-based GitLab Runner for CI/CD pipelines. Uses Docker executor with Docker-out-of-Docker (DooD) pattern.

## How It Works

1. `start.sh` validates `.env`, resolves `PROJECT_DIR`, starts the runner container
2. `entrypoint.sh` substitutes variables in `config.toml.template` → `config.toml`, starts `gitlab-runner run`
3. Runner registers with GitLab, listens for CI jobs matching its tags

## Setup

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Get runner token from GitLab UI:
#    Settings → CI/CD → Runners → New project runner
#    Set tags, then copy the token

# 3. Fill .env with your token and settings
# Required: GITLAB_URL, RUNNER_NAME, RUNNER_TOKEN

# 4. Start the runner
bash start.sh
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITLAB_VERSION` | yes | v18.10.3 | GitLab Runner Docker image version |
| `HELPER_VERSION` | yes | v18.10.3 | GitLab Runner Helper image version |
| `GITLAB_URL` | yes | — | GitLab instance URL |
| `RUNNER_TAGS` | no | {{project.name}},docker | Comma-separated tags for job matching |
| `RUNNER_NAME` | yes | — | Runner hostname and container name |
| `RUNNER_TOKEN` | yes | — | Authentication token from GitLab UI |
| `PROJECT_DIR` | no | ../../ | Absolute path to project on host |

## Management Commands

```bash
# Start
bash start.sh

# View logs
docker compose logs -f

# Check status
docker compose exec gitlab-runner gitlab-runner status

# Stop
docker compose down

# Restart
docker compose restart
```

## Infrastructure

- **Network:** `gitlab-network` (bridge)
- **DNS:** Corporate DNS servers (10.77.96.10, 10.77.196.10)
- **Executor:** Docker with `docker:27` default image
- **Volumes:** Docker socket, daemon.json, project directory, /cache
- **Healthcheck:** `gitlab-runner status` every 60s
