#!/bin/sh
set -e

TEMPLATE="/etc/gitlab-runner/config.toml.template"
CONFIG="/etc/gitlab-runner/config.toml"

if [ -z "$RUNNER_TOKEN" ]; then
  echo "ERROR: RUNNER_TOKEN is required" >&2
  exit 1
fi

if [ -z "$PROJECT_DIR" ]; then
  echo "ERROR: PROJECT_DIR is required" >&2
  exit 1
fi

sed \
  -e "s|__RUNNER_NAME__|${RUNNER_NAME}|g" \
  -e "s|__RUNNER_TOKEN__|${RUNNER_TOKEN}|g" \
  -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
  -e "s|__RUNNER_TAGS__|${RUNNER_TAGS}|g" \
  -e "s|__GITLAB_URL__|${GITLAB_URL}|g" \
  -e "s|__GITLAB_VERSION__|${GITLAB_VERSION}|g" \
  -e "s|__HELPER_VERSION__|${HELPER_VERSION}|g" \
  "$TEMPLATE" > "$CONFIG"

exec gitlab-runner run
