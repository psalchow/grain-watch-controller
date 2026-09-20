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
| `INFLUXDB_LATEST_LOOKBACK` | No | `6h` in production | Look-back window for all latest values; older readings are dropped |
| `INFLUXDB_OFFLINE_AFTER` | No | `1h` in production | Age at which a reading is shown as offline; must not exceed the look-back window |
| `INFLUXDB_OUTDOOR_MAX_SKEW` | No | `30m` | Maximum gap between the outdoor temperature and humidity timestamps for the derived values |
| `DATABASE_PATH` | No | `./data/grainwatch.db` | SQLite file; must sit on a mounted volume |
| `MQTT_URL` | No | `mqtt://localhost:1883` | Broker URL for fan control |
| `FAN_RECONCILE_INTERVAL_MS` | No | `60000` | How often revoked fan control is picked up from the database; at least 1000 ms |
| `DOCKER_NETWORK` | No | `grainwatch-network` | External Docker network name |

> **Persistence:** `DATABASE_PATH` must point inside a mounted volume. The SQLite
> file holds all users, stock configuration and fan history. Without a volume it
> is recreated empty on every container replacement, and the default admin is
> seeded again.

---

## Docker Build

The published image is [`psalchow/grainwatch`](https://hub.docker.com/r/psalchow/grainwatch)
on Docker Hub. Use `scripts/build-prod-image.sh`, which derives the version tag
from the root `package.json` and tags both `:<version>` and `:latest`:

```bash
# Build only
./scripts/build-prod-image.sh

# Build and publish both tags (requires docker login)
PUSH=1 ./scripts/build-prod-image.sh

# Force a clean rebuild
NO_CACHE=1 ./scripts/build-prod-image.sh
```

The build context is the repository root — the image builds both workspaces from
the root lockfile.

### Architecture

The image is built for the host architecture, and the target Synology is
**arm64**. Building on Apple Silicon therefore needs no `--platform`. From an
x86 machine, set `PLATFORM=linux/arm64`, which builds under emulation and takes
considerably longer because `better-sqlite3` is compiled from source.

Deploying an image of the wrong architecture fails at container start with
`exec format error`. Check what you built:

```bash
docker image inspect psalchow/grainwatch:1.0.0 --format '{{.Architecture}}'
```

### Verify the Build

```bash
# Check image size
docker images psalchow/grainwatch

# Confirm the compiled entry point and the bundled PWA are present
docker run --rm psalchow/grainwatch:latest ls dist/index.js public/index.html

# Confirm no secrets or development database were baked in
docker run --rm --entrypoint sh psalchow/grainwatch:latest -c \
  'find / -name ".env" -o -name "*.db" 2>/dev/null | grep -v node_modules'
```

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

The image is pulled from Docker Hub, so nothing has to be transferred to the NAS
apart from the compose file and the environment file.

### Option 1: docker-compose.prod.yml (Recommended)

```bash
# On the Synology
mkdir -p /volume1/docker/grainwatch/backend/data
cd /volume1/docker/grainwatch

# Transfer docker-compose.prod.yml and backend/.env from the dev machine:
#   scp docker-compose.prod.yml admin@synology:/volume1/docker/grainwatch/
#   scp backend/.env admin@synology:/volume1/docker/grainwatch/backend/

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The compose file already declares the data volume (`./backend/data:/app/data`),
the health check and the external network, so it is the least error-prone route.
It pins an explicit image version; override it without editing the file:

```bash
GRAINWATCH_IMAGE=psalchow/grainwatch:1.1.0 \
  docker compose -f docker-compose.prod.yml up -d
```

### Option 2: Command Line

SSH into the NAS:

```bash
ssh admin@synology
```

#### Step 1: Create the Directory Structure

```bash
mkdir -p /volume1/docker/grainwatch/data
chmod 755 /volume1/docker/grainwatch
chmod 755 /volume1/docker/grainwatch/data
```

#### Step 2: Pull the Image and Transfer the Environment File

```bash
# On the NAS
docker pull psalchow/grainwatch:1.0.0

# From the development machine
scp backend/.env admin@synology:/volume1/docker/grainwatch/
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
cd /volume1/docker/grainwatch

docker run -d \
  --name grainwatch-controller \
  --restart unless-stopped \
  --network grainwatch-network \
  -p 3000:3000 \
  --env-file .env \
  -e DATABASE_PATH=/app/data/grainwatch.db \
  -v $(pwd)/data:/app/data:rw \
  psalchow/grainwatch:1.0.0

docker ps | grep grainwatch-controller
docker logs -f grainwatch-controller
```

### Option 3: Synology Container Manager UI

1. Open Container Manager in DSM
2. Go to **Registry**, search for `psalchow/grainwatch` and download the
   `1.0.0` tag
3. Go to **Container** > **Create** and select the image
4. Configure:
   - **Container name**: grainwatch-controller
   - **Enable auto-restart**: Yes
5. **Advanced Settings**:
   - **Volume**: map `/volume1/docker/grainwatch/data` to `/app/data`
   - **Network**: select the network containing InfluxDB
   - **Port Settings**: local 3000 to container 3000
   - **Environment**: add the variables from `backend/.env.example`, including
     `DATABASE_PATH=/app/data/grainwatch.db`
6. Click **Apply** and **Next**

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
  "version": "1.1.0"
}
```

`version` is read from the root `package.json` bundled into the image. The PWA
shows the same value next to its own bundled version in the app-info dialog
(info icon in the header), which is the quickest way to confirm a deployment
took effect.

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

**Solution**: give the container's `appuser` (UID 1001) ownership of the host
directory behind the mount — `backend/data` when deploying via compose,
`data` when using the `docker run` route:

```bash
chmod 755 /volume1/docker/grainwatch/backend/data
chown 1001:1001 /volume1/docker/grainwatch/backend/data
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

Because the compose file pins a version, rolling back is a matter of naming the
previous tag:

```bash
GRAINWATCH_IMAGE=psalchow/grainwatch:<previous-version> \
  docker compose -f docker-compose.prod.yml up -d
```

Published versions are listed at
[hub.docker.com/r/psalchow/grainwatch/tags](https://hub.docker.com/r/psalchow/grainwatch/tags).
This is the reason to deploy explicit versions rather than `:latest` — a rollback
target only exists if the previous release has a name.

> Migrations are applied forward on startup and are not reversed by rolling the
> image back. Rolling back across a migration therefore needs the database
> backup taken before the upgrade.

### Data Backup Before Upgrade

```bash
# Stop the container first so SQLite is not mid-write
docker stop grainwatch-controller

cp -r /volume1/docker/grainwatch/data \
      /volume1/docker/grainwatch/data.backup.$(date +%Y%m%d)
cp /volume1/docker/grainwatch/backend/.env \
   /volume1/docker/grainwatch/backend/.env.backup
```

The database runs in WAL mode, so `grainwatch.db-wal` and `grainwatch.db-shm`
sit alongside `grainwatch.db`. Copying the directory while the container runs
can capture an inconsistent state — stop it first, which checkpoints the WAL.

### Full Recovery

```bash
docker compose -f docker-compose.prod.yml down

rm -rf /volume1/docker/grainwatch/backend/data
cp -r /volume1/docker/grainwatch/data.backup.YYYYMMDD \
      /volume1/docker/grainwatch/backend/data

GRAINWATCH_IMAGE=psalchow/grainwatch:<previous-version> \
  docker compose -f docker-compose.prod.yml up -d
```

---

## Upgrade Procedure

> **Breaking change — versions after the look-back rework:** `INFLUXDB_OUTDOOR_LOOKBACK`
> no longer exists and the backend **refuses to start** while it is still set.
> Rename it to `INFLUXDB_LATEST_LOOKBACK` in `/volume1/docker/grainwatch/backend/.env`
> — the file `docker-compose.prod.yml` declares as `env_file`; only the
> `docker run --env-file .env` flow above uses `/volume1/docker/grainwatch/.env`
> — *before* deploying, otherwise the container crash-loops. The variable now
> bounds stock readings as well as outdoor conditions, so a value chosen for
> outdoor alone (e.g. `1h`) is likely too tight — leave it unset to get the
> `6h` production default.

> **Rollback needs the database backup from step 1.** The same release drops the
> `device_count` column from `stocks`. The previous image still writes that
> column while seeding on startup, so pulling the old image back over the
> migrated database fails before the server listens. Roll back with **Full
> Recovery** above — restore `data.backup.YYYYMMDD`, then start the previous
> image — rather than by swapping the image alone.

> **Browsers on the old bundle briefly show "undefined devices".** The same
> release removes `deviceCount` from `GET /stocks`, which the previous PWA
> bundle still renders on the stock list. The service worker updates itself
> (`registerType: 'autoUpdate'`), so the wrong label disappears once the new
> bundle takes control; a reload fixes it immediately. Nothing is broken behind
> it — the value no longer exists anywhere.

```bash
# 1. Back up the database with the container stopped
cd /volume1/docker/grainwatch
docker compose -f docker-compose.prod.yml stop
cp -r backend/data data.backup.$(date +%Y%m%d)

# 2. Deploy the new version (pulls automatically)
GRAINWATCH_IMAGE=psalchow/grainwatch:<new-version> \
  docker compose -f docker-compose.prod.yml up -d

# 3. Verify — migrations run automatically on startup
docker compose -f docker-compose.prod.yml logs -f
curl http://localhost:3000/health
```

Once a version is proven, update the default in `docker-compose.prod.yml` so the
override is no longer needed.

### Zero-Downtime Upgrade

Blue-green is possible but **both containers must not share the SQLite volume** —
two processes writing the same database file will corrupt it. Run the new
container against a copy of the data, verify, then cut over:

```bash
cp -r backend/data data.green
docker run -d \
  --name grainwatch-controller-new \
  -p 3001:3000 \
  --env-file backend/.env \
  -e DATABASE_PATH=/app/data/grainwatch.db \
  -v $(pwd)/data.green:/app/data:rw \
  psalchow/grainwatch:<new-version>

curl http://localhost:3001/health

# Cut over: stop the old container, swap the data directory back, restart
```

For a single-operator deployment the simple stop-and-replace upgrade above is
usually the better trade-off.
