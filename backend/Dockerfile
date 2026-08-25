# =============================================================================
# Grainwatch Controller BFF - API-only Dockerfile
# =============================================================================
# Builds the BFF without the PWA. Used by docker-compose.sim.yml, where the
# frontend runs separately as a Vite dev server. The deployed production image
# is the combined one built from the root Dockerfile.
#
# Build context is the repository root, so the root package.json — the single
# source of truth for the product version, reported by /health — can be bundled.
# Dependencies still come from the standalone backend/package-lock.json, which
# keeps this image free of the frontend dependency tree.
#
#   docker build -f backend/Dockerfile -t grainwatch-controller .
#
# Base: Node.js 24 LTS Alpine for minimal footprint
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
# Separate stage for installing dependencies to maximise layer caching
FROM node:24-alpine AS dependencies

WORKDIR /app/backend

# Native build tools required by better-sqlite3 (node-gyp)
RUN apk add --no-cache python3 make g++

# Copy package files for dependency installation
COPY backend/package.json backend/package-lock.json ./

# Install all dependencies (including dev for build stage)
# Use --frozen-lockfile equivalent for npm
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
# Compile TypeScript to JavaScript
FROM node:24-alpine AS builder

WORKDIR /app/backend

# Copy dependencies from previous stage
COPY --from=dependencies /app/backend/node_modules ./node_modules

# Copy source files
COPY backend/package.json backend/package-lock.json backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
COPY backend/drizzle ./drizzle

# Build TypeScript
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
# Minimal runtime image
FROM node:24-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Mirrors the layout of the combined image: the application lives in
# /app/backend, the root manifest one level above.
WORKDIR /app/backend

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Set production environment
ENV NODE_ENV=production

# Copy production dependencies
COPY --from=builder --chown=appuser:nodejs /app/backend/node_modules ./node_modules

# Copy compiled application
COPY --from=builder --chown=appuser:nodejs /app/backend/dist ./dist

# Copy database migrations (migrate.ts resolves ../../drizzle from dist/db → /app/backend/drizzle)
COPY --from=builder --chown=appuser:nodejs /app/backend/drizzle ./drizzle

# Backend manifest for npm scripts
COPY --chown=appuser:nodejs backend/package.json ./

# Root manifest — holds the version /health reports (resolved as ../../package.json from dist)
COPY --chown=appuser:nodejs package.json /app/package.json

# Create data directory for user database
RUN mkdir -p /app/data && chown appuser:nodejs /app/data

# Switch to non-root user
USER appuser

# Expose application port
EXPOSE 3000

# Health check - verify the service is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))" || exit 1

# Use dumb-init to handle signals properly (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
