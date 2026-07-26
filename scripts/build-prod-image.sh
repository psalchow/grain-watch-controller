#!/usr/bin/env bash
# =============================================================================
# Grainwatch - Local Production Image Build
# =============================================================================
# Builds the combined PWA + BFF production image locally, ready for deployment
# via docker-compose.prod.yml (which expects grainwatch-controller:latest).
#
# The root Dockerfile is a multi-stage build: it compiles the React PWA and the
# Express BFF, and its final stage is the production runtime (NODE_ENV=production,
# non-root user, pruned deps) that serves the PWA as static files.
#
# Usage:
#   ./scripts/build-prod-image.sh                 # tag :latest and :<version>
#   IMAGE_NAME=my-registry/grainwatch ./scripts/build-prod-image.sh
#   NO_CACHE=1 ./scripts/build-prod-image.sh      # force a clean rebuild
# =============================================================================

set -euo pipefail

# Resolve repository root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

# Configuration (overridable via environment).
IMAGE_NAME="${IMAGE_NAME:-grainwatch-controller}"
BUILD_TARGET="${BUILD_TARGET:-production}"

# Derive the version tag from the backend package.json.
VERSION="$(node -p "require('${BACKEND_DIR}/package.json').version")"

# Assemble optional flags.
BUILD_ARGS=()
if [[ "${NO_CACHE:-0}" == "1" ]]; then
  BUILD_ARGS+=(--no-cache)
fi

echo "Building production image from ${REPO_ROOT}"
echo "  image:  ${IMAGE_NAME}:latest"
echo "  image:  ${IMAGE_NAME}:${VERSION}"
echo "  target: ${BUILD_TARGET}"
echo

docker build \
  --file "${REPO_ROOT}/Dockerfile" \
  --target "${BUILD_TARGET}" \
  --tag "${IMAGE_NAME}:latest" \
  --tag "${IMAGE_NAME}:${VERSION}" \
  ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
  "${REPO_ROOT}"

echo
echo "Built ${IMAGE_NAME}:latest and ${IMAGE_NAME}:${VERSION}"
echo "Deploy with: docker compose -f docker-compose.prod.yml up -d"
