# Build stage: compile TypeScript, then keep only production dependencies.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage: Node + Chromium (Openwa drives a real browser; it cannot run on serverless platforms).
# Openwa v5 also needs the `zstd` binary (session compression) and Node 22+.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    SESSION_DATA_DIR=/data/sessions
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium zstd fonts-liberation fonts-noto-color-emoji ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data/sessions && chown -R node:node /data /app
USER node
# dumb-init reaps the Chromium child processes so they can't accumulate as zombies.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
