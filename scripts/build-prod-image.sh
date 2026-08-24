#!/usr/bin/env bash
# =============================================================================
# Grainwatch - Production Image Build
# =============================================================================
# Builds the combined PWA + BFF production image, tagged :latest and :<version>
# with the version taken from backend/package.json. This is the image
# docker-compose.prod.yml deploys.
#
# The root Dockerfile is a multi-stage build: it compiles the React PWA and the
# Express BFF, and its final stage is the production runtime (NODE_ENV=production,
# non-root user, pruned deps) that serves the PWA as static files.
#
# The image is built for the host architecture. The target Synology is arm64, so
# building on Apple Silicon needs no --platform; from an x86 machine, set
# PLATFORM=linux/arm64 (slower, emulated).
#
# Usage:
#   ./scripts/build-prod-image.sh                 # build only
#   PUSH=1 ./scripts/build-prod-image.sh          # build, then push both tags
#   NO_CACHE=1 ./scripts/build-prod-image.sh      # force a clean rebuild
#   IMAGE_NAME=my-registry/grainwatch ./scripts/build-prod-image.sh
#   PLATFORM=linux/arm64 ./scripts/build-prod-image.sh
#
# Pushing requires `docker login` beforehand.
# =============================================================================

set -euo pipefail

# Resolve repository root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

# Configuration (overridable via environment).
IMAGE_NAME="${IMAGE_NAME:-psalchow/grainwatch}"
BUILD_TARGET="${BUILD_TARGET:-production}"

# Derive the version tag from the backend package.json.
VERSION="$(node -p "require('${BACKEND_DIR}/package.json').version")"

# Assemble optional flags.
BUILD_ARGS=()
if [[ "${NO_CACHE:-0}" == "1" ]]; then
  BUILD_ARGS+=(--no-cache)
fi
if [[ -n "${PLATFORM:-}" ]]; then
  BUILD_ARGS+=(--platform "${PLATFORM}")
fi

echo "Building production image from ${REPO_ROOT}"
echo "  image:  ${IMAGE_NAME}:latest"
echo "  image:  ${IMAGE_NAME}:${VERSION}"
echo "  target: ${BUILD_TARGET}"
echo "  push:   ${PUSH:-0}"
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

if [[ "${PUSH:-0}" == "1" ]]; then
  echo
  echo "Pushing ${IMAGE_NAME}:${VERSION} and ${IMAGE_NAME}:latest"
  docker push "${IMAGE_NAME}:${VERSION}"
  docker push "${IMAGE_NAME}:latest"
  echo
  echo "Pushed. On the NAS:"
  echo "  GRAINWATCH_IMAGE=${IMAGE_NAME}:${VERSION} \\"
  echo "    docker compose -f docker-compose.prod.yml up -d"
else
  echo "Not pushed (set PUSH=1 to publish)."
  echo "Deploy locally with: docker compose -f docker-compose.prod.yml up -d"
fi
