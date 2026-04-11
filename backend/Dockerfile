# =============================================================================
# Grainwatch Controller BFF - Production Dockerfile
# =============================================================================
# Multi-stage build for optimised production image
# Base: Node.js 24 LTS Alpine for minimal footprint
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
# Separate stage for installing dependencies to maximise layer caching
FROM node:24-alpine AS dependencies

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install all dependencies (including dev for build stage)
# Use --frozen-lockfile equivalent for npm
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
# Compile TypeScript to JavaScript
FROM node:24-alpine AS builder

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source files
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

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

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Set production environment
ENV NODE_ENV=production

# Copy production dependencies
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Copy compiled application
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist

# Copy package.json for version info and npm scripts
COPY --chown=appuser:nodejs package.json ./

# Create data directory for user database
RUN mkdir -p /app/data && chown appuser:nodejs /app/data

# Switch to non-root user
USER appuser

# Expose application port
EXPOSE 3000

# Health check - verify the service is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))" || exit 1

# Use dumb-init to handle signals properly (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
