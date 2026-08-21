# xcale-mcp-server — production image (DigitalOcean App Platform).
#
# TypeScript runs directly through tsx: no build step, no dist/ (see
# docs/adr/0012-deployment-runtime-and-hosting.md). `tsx` is therefore a runtime
# dependency, not a dev tool — that is why it lives in `dependencies`.

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Deps first: this layer is cached until package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Runtime sources. `assets/` is served publicly at /assets/:filename (provider logos).
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets

# The process never writes to its own filesystem.
USER node

EXPOSE 8080

# `node --import tsx` (not `npm start`): a single process as PID 1, so App Platform's
# SIGTERM reaches the server's graceful-shutdown handler directly.
CMD ["node", "--import", "tsx", "src/server.ts"]
