# Deployment Guide

This guide covers deploying the Grainwatch Controller BFF service, with a focus on Synology NAS deployment alongside existing infrastructure (InfluxDB, MQTT Broker, Sink Service).

## Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Docker Build](#docker-build)
- [Local Development](#local-development)
- [Synology NAS Deployment](#synology-nas-deployment)
- [Initial Setup](#initial-setup)
- [Health Monitoring](#health-monitoring)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Rollback Procedures](#rollback-procedures)

---

## Prerequisites

### Development Machine

- Node.js 24 LTS or higher
- Docker 20.10 or higher
- Docker Compose v2

### Synology NAS

- DSM 7.0 or higher
- Container Manager package installed
- SSH access enabled (for command-line deployment)
- Existing Docker network with InfluxDB accessible

### Network Requirements

- Access to InfluxDB instance (typically on the same Docker network)
- Port 3000 available (or configure alternative port)
- Optional: Reverse proxy configuration for HTTPS

---

## Environment Configuration

### Step 1: Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

### Step 2: Configure Variables

Edit `.env` with your production values:

```bash
# Server
PORT=3000
NODE_ENV=production

# JWT - REQUIRED: Generate a secure secret
# Use: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<your-64-character-secret-here>
JWT_EXPIRES_IN=24h

# InfluxDB - Match your existing setup
INFLUXDB_HOST=influxdb          # Container name or IP address
INFLUXDB_PORT=8086
INFLUXDB_DATABASE=cornwatch
INFLUXDB_MEASUREMENT=Temp
INFLUXDB_USERNAME=<if-required>
INFLUXDB_PASSWORD=<if-required>

# User storage
USERS_FILE_PATH=/app/data/users.json

# Docker network (must match existing network)
DOCKER_NETWORK=grainwatch-network
```

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | HTTP server port |
| `NODE_ENV` | No | development | Environment mode |
| `JWT_SECRET` | **Yes** (prod) | - | Token signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | No | 24h | Token expiry duration |
| `INFLUXDB_HOST` | No | localhost | InfluxDB hostname |
| `INFLUXDB_PORT` | No | 8086 | InfluxDB port |
| `INFLUXDB_DATABASE` | No | cornwatch | Database name |
| `INFLUXDB_MEASUREMENT` | No | Temp | Measurement name |
| `INFLUXDB_USERNAME` | No | - | Database username |
| `INFLUXDB_PASSWORD` | No | - | Database password |
| `USERS_FILE_PATH` | No | ./data/users.json | Path to user data file |
| `DOCKER_NETWORK` | No | grainwatch-network | Docker network name |

---

## Docker Build

### Build the Image

```bash
# Standard build
docker build -t grainwatch-controller:latest .

# Build with version tag
docker build -t grainwatch-controller:1.0.0 .

# Build with no cache (for clean builds)
docker build --no-cache -t grainwatch-controller:latest .
```

### Verify the Build

```bash
# Check image size (should be ~150-200MB)
docker images grainwatch-controller

# Inspect image layers
docker history grainwatch-controller:latest

# Test container starts correctly
docker run --rm grainwatch-controller:latest node --version
```

### Export for Synology

If building on a different machine:

```bash
# Save image to file
docker save grainwatch-controller:latest | gzip > grainwatch-controller.tar.gz

# Copy to Synology
scp grainwatch-controller.tar.gz admin@synology:/volume1/docker/

# On Synology: Load the image
docker load < /volume1/docker/grainwatch-controller.tar.gz
```

---

## Local Development

### Using Docker Compose

```bash
# Start all services (BFF + test InfluxDB)
docker-compose up -d

# View logs
docker-compose logs -f grainwatch-controller

# Stop services
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

### Without Docker (Development)

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Run tests
npm test
```

---

## Synology NAS Deployment

### Option 1: Command Line (Recommended)

SSH into your Synology NAS:

```bash
ssh admin@synology
```

#### Step 1: Create Directory Structure

```bash
# Create application directory
mkdir -p /volume1/docker/grainwatch-controller/data

# Set permissions
chmod 755 /volume1/docker/grainwatch-controller
chmod 755 /volume1/docker/grainwatch-controller/data
```

#### Step 2: Transfer Files

From your development machine:

```bash
# Transfer Docker image
docker save grainwatch-controller:latest | ssh admin@synology "docker load"

# Or transfer tar file
scp grainwatch-controller.tar.gz admin@synology:/volume1/docker/grainwatch-controller/
ssh admin@synology "docker load < /volume1/docker/grainwatch-controller/grainwatch-controller.tar.gz"

# Transfer environment file
scp .env admin@synology:/volume1/docker/grainwatch-controller/
```

#### Step 3: Verify Network Configuration

```bash
# List existing networks
docker network ls

# Identify the network your InfluxDB uses
docker inspect influxdb | grep -A 10 "Networks"

# If needed, create the network
docker network create grainwatch-network

# Connect InfluxDB to the network (if not already)
docker network connect grainwatch-network influxdb
```

#### Step 4: Start the Container

```bash
# Navigate to application directory
cd /volume1/docker/grainwatch-controller

# Run the container
docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/data:/app/data:rw \
  grainwatch-controller:latest

# Verify it started
docker ps | grep grainwatch-controller

# Check logs
docker logs -f grainwatch-controller
```

### Option 2: Synology Container Manager UI

1. Open Container Manager in DSM
2. Go to **Image** > **Add** > **Add from file**
3. Select the exported `grainwatch-controller.tar.gz`
4. Go to **Container** > **Create**
5. Configure:
   - **Container name**: grainwatch-controller
   - **Enable auto-restart**: Yes
6. **Advanced Settings**:
   - **Volume**: Add `/volume1/docker/grainwatch-controller/data` mapped to `/app/data`
   - **Network**: Select the network containing InfluxDB
   - **Port Settings**: Local 3000 to Container 3000
   - **Environment**: Add all variables from `.env.example`
7. Click **Apply** and **Next** to create

### Option 3: Using docker-compose.prod.yml

```bash
# On Synology
cd /volume1/docker/grainwatch-controller

# Ensure .env file exists with production values
# Then start the service
docker-compose -f docker-compose.prod.yml up -d
```

---

## Initial Setup

### Creating the Default Admin User

The service requires at least one admin user to manage other users. Create the initial user file before first start.

#### Option 1: Use Example File as Template

```bash
# Copy example users file
cp data/users.example.json data/users.json

# Generate a password hash for your admin user
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-secure-password', 10).then(h => console.log(h));"

# Edit data/users.json and replace the example hash with your generated hash
```

#### Option 2: Create via API (After First Start)

If the application supports user creation API (check API documentation):

```bash
# Start the service (it will create an empty users file)
docker start grainwatch-controller

# Use the admin creation endpoint if available
curl -X POST http://localhost:3000/api/v1/admin/users \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secure-password", "role": "admin"}'
```

### Users File Structure

```json
[
  {
    "id": "usr_001",
    "username": "admin",
    "passwordHash": "$2b$10$...",
    "email": "admin@example.com",
    "role": "admin",
    "stockAccess": ["*"],
    "createdAt": "2026-01-01T00:00:00.000Z",
    "active": true
  }
]
```

---

## Health Monitoring

### Health Check Endpoint

The service exposes a health endpoint at:

```
GET /api/v1/health
```

Response when healthy:

```json
{
  "status": "healthy",
  "timestamp": "2026-01-16T10:30:00.000Z",
  "version": "0.1.0"
}
```

### Docker Health Status

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' grainwatch-controller

# View health check logs
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' grainwatch-controller
```

### Monitoring Commands

```bash
# Container resource usage
docker stats grainwatch-controller

# Application logs
docker logs -f --tail 100 grainwatch-controller

# Check if service responds
curl -s http://localhost:3000/api/v1/health | jq .
```

---

## Troubleshooting

### Container Fails to Start

**Symptom**: Container exits immediately after starting.

```bash
# Check exit logs
docker logs grainwatch-controller

# Common causes:
# 1. Missing JWT_SECRET in production mode
# 2. Invalid environment variables
# 3. Port already in use
```

**Solution**: Verify all required environment variables are set correctly.

### Cannot Connect to InfluxDB

**Symptom**: API returns database connection errors.

```bash
# Verify network connectivity
docker exec grainwatch-controller ping influxdb

# Check InfluxDB is accessible
docker exec grainwatch-controller node -e "
  const http = require('http');
  http.get('http://influxdb:8086/ping', (res) => {
    console.log('Status:', res.statusCode);
  }).on('error', (e) => console.error('Error:', e.message));
"
```

**Solution**:
1. Ensure both containers are on the same Docker network
2. Verify `INFLUXDB_HOST` matches the container name
3. Check InfluxDB credentials if authentication is enabled

### Authentication Failures

**Symptom**: 401 Unauthorized responses.

```bash
# Check JWT secret is consistent
docker exec grainwatch-controller printenv JWT_SECRET | head -c 10

# Verify token expiry settings
docker exec grainwatch-controller printenv JWT_EXPIRES_IN
```

**Solution**: Ensure JWT_SECRET is at least 32 characters and consistent across restarts.

### Permission Denied on Data Directory

**Symptom**: Cannot write to users.json file.

```bash
# Check file permissions
docker exec grainwatch-controller ls -la /app/data/

# Verify volume mount
docker inspect grainwatch-controller | grep -A 5 "Mounts"
```

**Solution**:
```bash
# Fix host directory permissions
chmod 755 /volume1/docker/grainwatch-controller/data
chown 1001:1001 /volume1/docker/grainwatch-controller/data
```

### High Memory Usage

**Symptom**: Container uses excessive memory.

```bash
# Check current usage
docker stats grainwatch-controller --no-stream

# Set memory limits
docker update --memory 256m --memory-swap 256m grainwatch-controller
```

---

## Security Considerations

### Credentials Management

1. **Never commit `.env` files** to version control
2. **Generate strong JWT secrets**: Minimum 32 characters, use cryptographic random generation
3. **Rotate secrets periodically**: Update JWT_SECRET and invalidate existing tokens
4. **Use separate credentials** for development and production

### Network Security

1. **Internal network only**: Keep the service on an internal Docker network
2. **Reverse proxy**: Use Nginx or Synology Web Station for HTTPS termination
3. **Firewall rules**: Restrict port 3000 access to trusted sources

### Container Security

1. **Non-root user**: The container runs as `appuser` (UID 1001)
2. **Read-only filesystem**: Consider adding `--read-only` with appropriate tmpfs mounts
3. **Security scanning**: Regularly scan the image for vulnerabilities

```bash
# Run with enhanced security
docker run -d \
  --name grainwatch-controller \
  --read-only \
  --tmpfs /tmp \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  ...
```

### Secrets in Environment Variables

For enhanced security on Synology, consider using Docker secrets:

```bash
# Create secret files
echo "your-jwt-secret" > /volume1/docker/secrets/jwt_secret

# Mount as secret
docker run -d \
  --name grainwatch-controller \
  -v /volume1/docker/secrets/jwt_secret:/run/secrets/jwt_secret:ro \
  -e JWT_SECRET_FILE=/run/secrets/jwt_secret \
  ...
```

---

## Rollback Procedures

### Quick Rollback

If deployment fails, restore the previous version:

```bash
# Stop the current container
docker stop grainwatch-controller

# Remove the problematic container
docker rm grainwatch-controller

# List available image versions
docker images grainwatch-controller

# Start with previous version
docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/data:/app/data:rw \
  grainwatch-controller:previous-version
```

### Data Backup Before Upgrade

```bash
# Backup user data
cp -r /volume1/docker/grainwatch-controller/data /volume1/docker/grainwatch-controller/data.backup.$(date +%Y%m%d)

# Backup environment
cp /volume1/docker/grainwatch-controller/.env /volume1/docker/grainwatch-controller/.env.backup
```

### Full Recovery

If both application and data need restoration:

```bash
# Stop and remove current container
docker stop grainwatch-controller
docker rm grainwatch-controller

# Restore data
rm -rf /volume1/docker/grainwatch-controller/data
cp -r /volume1/docker/grainwatch-controller/data.backup.YYYYMMDD /volume1/docker/grainwatch-controller/data

# Restore previous image version
docker load < /volume1/docker/backups/grainwatch-controller-previous.tar.gz

# Restart with restored configuration
docker run -d --name grainwatch-controller ...
```

---

## Upgrade Procedure

### Standard Upgrade

```bash
# 1. Backup current state
docker commit grainwatch-controller grainwatch-controller:backup-$(date +%Y%m%d)
cp -r data data.backup.$(date +%Y%m%d)

# 2. Pull or load new image
docker load < grainwatch-controller-new.tar.gz
# or: docker pull your-registry/grainwatch-controller:new-version

# 3. Stop current container
docker stop grainwatch-controller

# 4. Remove current container (data persists in volume)
docker rm grainwatch-controller

# 5. Start new version
docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/data:/app/data:rw \
  grainwatch-controller:new-version

# 6. Verify health
docker logs -f grainwatch-controller
curl http://localhost:3000/api/v1/health
```

### Zero-Downtime Upgrade (Advanced)

For critical deployments, consider blue-green deployment:

```bash
# Start new version on different port
docker run -d \
  --name grainwatch-controller-new \
  -p 3001:3000 \
  ... \
  grainwatch-controller:new-version

# Verify new version
curl http://localhost:3001/api/v1/health

# Update reverse proxy to point to new container
# Then remove old container
docker stop grainwatch-controller
docker rm grainwatch-controller
docker rename grainwatch-controller-new grainwatch-controller
```
