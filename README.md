# Grainwatch

Grain stock monitoring system — a React PWA frontend with an Express.js backend.

## Quick Start

```bash
# Install dependencies
npm install

# Start development servers
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Project Structure

| Directory | Description |
|-----------|-------------|
| `frontend/` | React PWA (Vite, Tailwind CSS, TypeScript) |
| `backend/` | Express.js BFF (TypeScript, InfluxDB, JWT) |
| `docs/` | Shared documentation |

## Docker

```bash
# Development (includes local InfluxDB)
docker compose up

# Production
docker compose -f docker-compose.prod.yml up -d
```

## Documentation

- [Architecture](docs/specs/ARCHITECTURE.md)
- [API Design](docs/specs/API.md)
- [Authentication](docs/specs/AUTHENTICATION.md)
- [Deployment](docs/DEPLOYMENT.md)
