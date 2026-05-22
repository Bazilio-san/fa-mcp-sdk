#!/bin/bash
set -e
cd "$(dirname "$0")"

# Проверка наличия .env файла
if [ ! -f .env ]; then
    echo "ERROR: .env file not found in $(pwd)"
    echo "Copy .env.example to .env and fill in the values:"
    echo "  cp .env.example .env"
    exit 1
fi

# Загружаем .env в текущий shell
set -a
. .env
set +a

# Проверка обязательных переменных
required_vars=(
    "GITLAB_URL"
    "RUNNER_NAME"
    "RUNNER_TOKEN"
)
missing=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing+=("$var")
    fi
done
if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: Required variables not set in .env:"
    for var in "${missing[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

# PROJECT_DIR: если не задан — два уровня вверх (корень проекта)
if [ -z "$PROJECT_DIR" ]; then
    PROJECT_DIR="../.."
fi

# Резолвим в абсолютный путь
PROJECT_DIR=$(cd "$PROJECT_DIR" && pwd)
export PROJECT_DIR

exec docker compose up -d "$@"
