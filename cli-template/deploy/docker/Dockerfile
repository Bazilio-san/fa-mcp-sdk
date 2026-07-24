# ── Stage 1: install + build ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Dependencies (cached as a separate layer)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# Sources and build config
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY config/ ./config/

# Backend build (tsc → dist/)
RUN npm run build

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --production=true && yarn cache clean

# Built backend
COPY --from=builder /app/dist/ ./dist/

# Configs (default.yaml, production.yaml, custom-environment-variables.yaml, etc.)
COPY --from=builder /app/config/ ./config/

# External configs (local.yaml) are mounted via volumes in docker-compose.yml.

EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --spider -q http://localhost:{{port}}/health || exit 1

ENTRYPOINT ["node", "dist/src/start.js"]
