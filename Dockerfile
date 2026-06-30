# Multi-stage build: compile the client + server, then ship a slim runtime image
# that serves the built website AND the API from one Node process.

# ---- Build stage ---------------------------------------------------------
FROM node:22-slim AS build

# Build the frontend (copy manifests first for better layer caching).
# We use `npm install` (not `npm ci`) because the lockfile is generated on
# Windows and omits Linux-only optional native deps (Tailwind v4's engine);
# `npm install` pulls the correct per-platform binaries inside the container.
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# Build the backend
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build

# ---- Runtime stage -------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
# Tell the server where the built website lives inside the image.
ENV CLIENT_DIST=/app/client/dist

# Only production dependencies for the server (no TypeScript/tsx at runtime)
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy compiled output from the build stage
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist /app/client/dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
