# ── Stage 1: install + build ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Зависимости (кэшируется отдельным слоем)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# Исходники и конфиг сборки
COPY tsconfig.json tsoa.json ./
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

# Только production-зависимости
COPY package.json yarn.lock ./
RUN yarn install --production=true && yarn cache clean

# Собранный backend
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/swagger/ ./swagger/

# Конфиги (default.yaml, production.yaml, custom-environment-variables.yaml и т.д.)
COPY --from=builder /app/config/ ./config/

# Внешние конфиги (local.yaml) монтируются через volumes в docker-compose.yml.

EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --spider -q http://localhost:{{port}}/health || exit 1

ENTRYPOINT ["node", "dist/src/start.js"]
