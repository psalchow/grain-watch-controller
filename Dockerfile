# =============================================================================
# Grainwatch - Production Dockerfile (combined PWA + BFF)
# =============================================================================
# Builds the React PWA and the Express BFF into a single image. The backend
# serves the compiled frontend as static files, so one container delivers both.
#
# Build context is the repository root. Dependencies are installed once via npm
# workspaces from the root lockfile (the project's source of truth), which keeps
# the install reproducible and consistent with local development.
#
# Base: Node.js 24 Alpine for a minimal footprint.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
# Install workspace dependencies, build both the PWA and the BFF, then drop dev
# dependencies from the shared node_modules tree.
FROM node:24-alpine AS builder

WORKDIR /app

# Native build tools required by better-sqlite3 (node-gyp)
RUN apk add --no-cache python3 make g++

# Install all workspace dependencies from the root lockfile.
# Only the manifests are copied first to maximise layer caching.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN npm ci

# Copy workspace sources and build each workspace.
COPY frontend ./frontend
COPY backend ./backend
RUN npm run build --workspace=frontend
RUN npm run build --workspace=backend

# Remove dev dependencies from the shared (hoisted) node_modules tree.
RUN npm prune --omit=dev

# -----------------------------------------------------------------------------
# Stage 2: Production runtime
# -----------------------------------------------------------------------------
# Minimal runtime image serving both the API and the PWA.
FROM node:24-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Production environment. FRONTEND_DIST_PATH points at the bundled PWA; the
# backend runs from /app/backend so Node resolves the shared /app/node_modules
# and migrate.ts resolves ../../drizzle to /app/backend/drizzle.
ENV NODE_ENV=production \
    FRONTEND_DIST_PATH=/app/backend/public

# Shared (hoisted) production dependencies
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Compiled backend, migrations and manifest
COPY --from=builder --chown=appuser:nodejs /app/backend/dist ./backend/dist
COPY --from=builder --chown=appuser:nodejs /app/backend/drizzle ./backend/drizzle
COPY --chown=appuser:nodejs backend/package.json ./backend/

# Built PWA, served as static files
COPY --from=builder --chown=appuser:nodejs /app/frontend/dist ./backend/public

# Create data directory for the user database
RUN mkdir -p /app/data && chown appuser:nodejs /app/data

# Switch to non-root user
USER appuser

WORKDIR /app/backend

# Expose application port
EXPOSE 3000

# Health check - verify the service is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))" || exit 1

# Use dumb-init to handle signals properly (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
