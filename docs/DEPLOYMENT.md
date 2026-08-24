# Deployment Guide

This guide covers deploying Grainwatch to a Synology NAS alongside the existing
infrastructure (InfluxDB, MQTT broker, sink service).

The production image is a **single container serving both the PWA and the API**.
The React frontend is built into static assets and served by the Express backend
from the same origin, so port 3000 delivers the whole application — there is no
separate frontend container and no CORS configuration needed in the default
same-origin setup.

## Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Docker Build](#docker-build)
- [Local Development](#local-development)
- [Synology NAS Deployment](#synology-nas-deployment)
- [First Start](#first-start)
- [Health Monitoring](#health-monitoring)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Rollback Procedures](#rollback-procedures)
- [Upgrade Procedure](#upgrade-procedure)

---

## Prerequisites

### Development Machine

- Node.js 22 or higher (the Docker image builds on Node 24 Alpine)
- Docker 20.10 or higher
- Docker Compose v2

### Synology NAS

- DSM 7.0 or higher
- Container Manager package installed
- SSH access enabled (for command-line deployment)
- Existing Docker network with InfluxDB accessible

### Network Requirements

- Access to the InfluxDB instance (typically on the same Docker network)
- Access to the MQTT broker, if fan control is used for any stock
- Port 3000 available (or configure an alternative host port)
- Optional: reverse proxy configuration for HTTPS

---

## Environment Configuration

### Step 1: Create the Environment File

The compose file reads `./backend/.env` relative to itself, so the environment
file lives in the `backend` directory:

```bash
cp backend/.env.example backend/.env
```

### Step 2: Configure Variables

Edit `backend/.env` with your production values. The minimum viable production
configuration:

```bash
# Server
PORT=3000
NODE_ENV=production

# JWT — REQUIRED: generate two distinct secrets
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<your-64-character-secret-here>
JWT_REFRESH_SECRET=<a-second-distinct-64-character-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# Refresh cookie — Secure requires HTTPS, so keep the reverse proxy in mind
COOKIE_SECURE=true
COOKIE_SAMESITE=lax

# InfluxDB 2.x (v1 compatibility API)
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_TOKEN=<your-influxdb-api-token>
INFLUXDB_ORG=grainwatch
INFLUXDB_BUCKET=grainwatch
INFLUXDB_MEASUREMENT=Temp

# SQLite user database (inside the container; back this path with a volume)
DATABASE_PATH=/app/data/grainwatch.db

# MQTT — only needed when a stock has fan control configured
MQTT_URL=mqtt://mqtt-broker:1883
MQTT_USERNAME=
MQTT_PASSWORD=

# Docker network (must match your existing network)
DOCKER_NETWORK=grainwatch-network
```

### Environment Variables Reference

The full reference — including the outdoor-measurement and fan-timing variables
— lives in [specs/API.md](specs/API.md#configuration) and
`backend/.env.example`. The deployment-critical subset:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Set to `production` when deploying |
| `JWT_SECRET` | **Yes** (prod) | — | Access token signing secret, min 32 chars |
| `JWT_REFRESH_SECRET` | **Yes** (prod) | — | Refresh token secret; must differ from `JWT_SECRET` |
| `JWT_EXPIRES_IN` | No | `15m` | Access token expiry |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Refresh token expiry |
| `COOKIE_SECURE` | No | `true` in production | `Secure` attribute on the refresh cookie |
| `COOKIE_SAMESITE` | No | `lax` | `lax`, `strict` or `none` |
| `CORS_ALLOWED_ORIGINS` | No | — | Only needed when the PWA is served from another origin |
| `FRONTEND_DIST_PATH` | No | `/app/backend/public` | Set by the image; leave unless serving API-only |
| `INFLUXDB_URL` | No | `http://localhost:8086` | InfluxDB server URL |
| `INFLUXDB_TOKEN` | In practice | — | InfluxDB API token; not validated at boot, but every query fails without it |
| `INFLUXDB_ORG` | No | `grainwatch` | InfluxDB organisation |
| `INFLUXDB_BUCKET` | No | `grainwatch` | InfluxDB bucket |
| `INFLUXDB_MEASUREMENT` | No | `Temp` | Stock measurement name |
| `DATABASE_PATH` | No | `./data/grainwatch.db` | SQLite file; must sit on a mounted volume |
| `MQTT_URL` | No | `mqtt://localhost:1883` | Broker URL for fan control |
| `DOCKER_NETWORK` | No | `grainwatch-network` | External Docker network name |

> **Persistence:** `DATABASE_PATH` must point inside a mounted volume. The SQLite
> file holds all users, stock configuration and fan history. Without a volume it
> is recreated empty on every container replacement, and the default admin is
> seeded again.

---

## Docker Build

The build context is the repository root — the image builds both workspaces from
the root lockfile.

```bash
# Standard build
docker build -t grainwatch-controller:latest .

# Build with a version tag
docker build -t grainwatch-controller:1.0.0 .

# Clean build
docker build --no-cache -t grainwatch-controller:latest .
```

### Verify the Build

```bash
# Check image size
docker images grainwatch-controller

# Confirm the compiled entry point and the bundled PWA are present
docker run --rm grainwatch-controller:latest ls dist/index.js public/index.html
```

### Export for Synology

If building on a different machine:

```bash
# Save the image to a file
docker save grainwatch-controller:latest | gzip > grainwatch-controller.tar.gz

# Copy to the Synology
scp grainwatch-controller.tar.gz admin@synology:/volume1/docker/

# On the Synology: load the image
docker load < /volume1/docker/grainwatch-controller.tar.gz
```

> The image is built for the architecture of the build machine. Building on an
> Apple Silicon Mac for an x86 Synology requires
> `docker build --platform linux/amd64 ...`.

---

## Local Development

### Using Docker Compose

```bash
# Start the stack including a local InfluxDB
docker compose up -d

# View logs
docker compose logs -f grainwatch-controller

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build
```

### Full Simulation Stack

`docker-compose.sim.yml` runs the production image against a seeded InfluxDB and
a Shelly device emulator — the closest rehearsal for a real deployment. See
`sim/README.md`.

### Without Docker

```bash
npm install
npm run dev      # frontend on :5173, backend on :3000
npm test
```

---

## Synology NAS Deployment

### Option 1: docker-compose.prod.yml (Recommended)

```bash
# On the Synology
mkdir -p /volume1/docker/grainwatch-controller/backend/data
cd /volume1/docker/grainwatch-controller

# Transfer docker-compose.prod.yml and backend/.env from the dev machine, then:
docker compose -f docker-compose.prod.yml up -d
```

The compose file already declares the data volume (`./backend/data:/app/data`),
the health check and the external network, so it is the least error-prone route.

### Option 2: Command Line

SSH into the NAS:

```bash
ssh admin@synology
```

#### Step 1: Create the Directory Structure

```bash
mkdir -p /volume1/docker/grainwatch-controller/data
chmod 755 /volume1/docker/grainwatch-controller
chmod 755 /volume1/docker/grainwatch-controller/data
```

#### Step 2: Transfer Files

From the development machine:

```bash
# Transfer the image directly
docker save grainwatch-controller:latest | ssh admin@synology "docker load"

# Or via a tar file
scp grainwatch-controller.tar.gz admin@synology:/volume1/docker/grainwatch-controller/
ssh admin@synology "docker load < /volume1/docker/grainwatch-controller/grainwatch-controller.tar.gz"

# Transfer the environment file
scp backend/.env admin@synology:/volume1/docker/grainwatch-controller/
```

#### Step 3: Verify the Network

```bash
docker network ls
docker inspect influxdb | grep -A 10 "Networks"

# Create and attach if needed
docker network create grainwatch-network
docker network connect grainwatch-network influxdb
```

#### Step 4: Start the Container

```bash
cd /volume1/docker/grainwatch-controller

docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -e DATABASE_PATH=/app/data/grainwatch.db \
  -v $(pwd)/data:/app/data:rw \
  grainwatch-controller:latest

docker ps | grep grainwatch-controller
docker logs -f grainwatch-controller
```

### Option 3: Synology Container Manager UI

1. Open Container Manager in DSM
2. Go to **Image** > **Add** > **Add from file**
3. Select the exported `grainwatch-controller.tar.gz`
4. Go to **Container** > **Create**
5. Configure:
   - **Container name**: grainwatch-controller
   - **Enable auto-restart**: Yes
6. **Advanced Settings**:
   - **Volume**: map `/volume1/docker/grainwatch-controller/data` to `/app/data`
   - **Network**: select the network containing InfluxDB
   - **Port Settings**: local 3000 to container 3000
   - **Environment**: add the variables from `backend/.env.example`, including
     `DATABASE_PATH=/app/data/grainwatch.db`
7. Click **Apply** and **Next**

---

## First Start

No manual user setup is required. On startup the application:

1. Opens the SQLite database at `DATABASE_PATH`, creating the file if absent
2. Runs the Drizzle migrations in `backend/drizzle/`
3. Seeds the stock configuration
4. Creates a default admin **only if the user table is empty**
5. Initialises fan control over MQTT for every fan-enabled stock (skipped with a
   warning when no broker is configured, rather than failing the boot)

The seeded admin is:

```
Username: admin
Password: changeme123
```

It is created with `mustChangePassword` set, so the first login is forced through
the password-change screen at `/account` and the account cannot be used for
anything else until a new password is set. The credentials are also printed to
the container log on the run that creates them.

Verify the bootstrap:

```bash
docker logs grainwatch-controller | grep -A 6 "Default Admin User Created"
```

Then open the application at `http://<nas>:3000`, log in as `admin` /
`changeme123`, and set a new password when prompted.

Further users are created through the UI at **Users** in the header (admin only),
or via `POST /api/v1/admin/users`. Admin-created users likewise start with a
forced password change.

---

## Health Monitoring

### Health Check Endpoint

The service exposes a health endpoint outside the API prefix:

```
GET /health
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
docker inspect --format='{{.State.Health.Status}}' grainwatch-controller
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' grainwatch-controller
```

### Monitoring Commands

```bash
docker stats grainwatch-controller
docker logs -f --tail 100 grainwatch-controller
curl -s http://localhost:3000/health | jq .
```

---

## Troubleshooting

### Container Fails to Start

**Symptom**: container exits immediately after starting.

```bash
docker logs grainwatch-controller
```

Common causes:

1. `JWT_SECRET` or `JWT_REFRESH_SECRET` missing or under 32 characters in production
2. `JWT_REFRESH_SECRET` identical to `JWT_SECRET` (rejected on purpose)
3. `DATABASE_PATH` pointing at a directory the `appuser` (UID 1001) cannot write
4. Port already in use

### Cannot Connect to InfluxDB

**Symptom**: API returns database connection errors.

```bash
# Verify network connectivity
docker exec grainwatch-controller wget -qO- http://influxdb:8086/ping

# Inspect the configured URL
docker exec grainwatch-controller printenv INFLUXDB_URL
```

**Solution**:

1. Ensure both containers are on the same Docker network
2. Verify `INFLUXDB_URL` uses the container name and port, not a bare hostname
3. Check that `INFLUXDB_TOKEN` is valid and the token has read access to the bucket
4. Confirm the DBRP mapping exists — the v1 compatibility API needs one for the bucket

### Authentication Failures

**Symptom**: 401 responses, or users logged out on every restart.

```bash
docker exec grainwatch-controller printenv JWT_SECRET | head -c 10
docker exec grainwatch-controller printenv JWT_EXPIRES_IN
```

**Solution**: both secrets must be at least 32 characters and stable across
restarts — a regenerated secret invalidates every issued token and cookie. If
login succeeds but the session drops after 15 minutes, the refresh cookie is not
reaching the server: check `COOKIE_SECURE` against whether the site is actually
served over HTTPS, and `COOKIE_SAMESITE` against whether the PWA and API share a
registrable domain.

### Permission Denied on the Data Directory

**Symptom**: `SQLITE_CANTOPEN`, or the database resets on every restart.

```bash
docker exec grainwatch-controller ls -la /app/data/
docker inspect grainwatch-controller | grep -A 5 "Mounts"
```

**Solution**:

```bash
chmod 755 /volume1/docker/grainwatch-controller/data
chown 1001:1001 /volume1/docker/grainwatch-controller/data
```

A database that resets means `DATABASE_PATH` points outside the mounted volume —
every restart then re-seeds the default admin.

### Fan Control Inactive

**Symptom**: the fan card shows no status, log says fan control was skipped.

```bash
docker logs grainwatch-controller | grep -i "fan control"
```

`Fan control: no fan-enabled stocks` means no stock in the database is
configured for it — the likely case if the fan card is missing entirely.

Note that a fan-enabled stock plus an unreachable broker does *not* produce a
warning at boot: `MQTT_URL` always resolves to a default, so the manager
initialises and the connection failure surfaces later in the MQTT client logs
rather than during bootstrap. Check `MQTT_URL` reachability from inside the
container if the card renders but never updates.

### High Memory Usage

```bash
docker stats grainwatch-controller --no-stream
docker update --memory 256m --memory-swap 256m grainwatch-controller
```

---

## Security Considerations

### Credentials Management

1. **Never commit `.env` files** to version control
2. **Generate strong secrets**: minimum 32 characters, cryptographic randomness,
   and `JWT_REFRESH_SECRET` must differ from `JWT_SECRET`
3. **Rotate periodically**: changing either secret invalidates existing sessions
4. **Change the seeded admin password** on first login — the forced-change screen
   enforces this, but the default is public knowledge until you do
5. **Use separate credentials** for development and production

### Network Security

1. **Internal network only**: keep the service on an internal Docker network
2. **Reverse proxy**: use Nginx or Synology Web Station for HTTPS termination —
   required if `COOKIE_SECURE=true`, which is the production default
3. **Firewall rules**: restrict port 3000 to trusted sources

### Container Security

1. **Non-root user**: the container runs as `appuser` (UID 1001)
2. **Signal handling**: `dumb-init` is the entry point, so shutdowns are graceful
3. **Security scanning**: regularly scan the image for vulnerabilities

A read-only root filesystem is possible but needs a writable mount for
`/app/data`, since SQLite writes the database and its WAL there.

---

## Rollback Procedures

### Quick Rollback

```bash
docker stop grainwatch-controller
docker rm grainwatch-controller

docker images grainwatch-controller

docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -e DATABASE_PATH=/app/data/grainwatch.db \
  -v $(pwd)/data:/app/data:rw \
  grainwatch-controller:previous-version
```

> Migrations are applied forward on startup and are not reversed by rolling the
> image back. Rolling back across a migration therefore needs the database
> backup taken before the upgrade.

### Data Backup Before Upgrade

```bash
# Stop the container first so SQLite is not mid-write
docker stop grainwatch-controller

cp -r /volume1/docker/grainwatch-controller/data \
      /volume1/docker/grainwatch-controller/data.backup.$(date +%Y%m%d)
cp /volume1/docker/grainwatch-controller/.env \
   /volume1/docker/grainwatch-controller/.env.backup
```

### Full Recovery

```bash
docker stop grainwatch-controller
docker rm grainwatch-controller

rm -rf /volume1/docker/grainwatch-controller/data
cp -r /volume1/docker/grainwatch-controller/data.backup.YYYYMMDD \
      /volume1/docker/grainwatch-controller/data

docker load < /volume1/docker/backups/grainwatch-controller-previous.tar.gz
docker compose -f docker-compose.prod.yml up -d
```

---

## Upgrade Procedure

```bash
# 1. Back up the database with the container stopped
docker stop grainwatch-controller
cp -r data data.backup.$(date +%Y%m%d)

# 2. Load the new image
docker load < grainwatch-controller-new.tar.gz

# 3. Replace the container (data persists in the volume)
docker rm grainwatch-controller

docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -e DATABASE_PATH=/app/data/grainwatch.db \
  -v $(pwd)/data:/app/data:rw \
  grainwatch-controller:new-version

# 4. Verify — migrations run automatically on startup
docker logs -f grainwatch-controller
curl http://localhost:3000/health
```

### Zero-Downtime Upgrade

Blue-green is possible but **both containers must not share the SQLite volume** —
two processes writing the same database file will corrupt it. Run the new
container against a copy of the data, verify, then cut over:

```bash
cp -r data data.green
docker run -d \
  --name grainwatch-controller-new \
  -p 3001:3000 \
  --env-file .env \
  -e DATABASE_PATH=/app/data/grainwatch.db \
  -v $(pwd)/data.green:/app/data:rw \
  grainwatch-controller:new-version

curl http://localhost:3001/health

# Cut over: stop the old container, swap the data directory back, restart
```

For a single-operator deployment the simple stop-and-replace upgrade above is
usually the better trade-off.
