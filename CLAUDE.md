# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Monorepo for the Grainwatch grain stock monitoring system. Contains a React PWA frontend and an Express.js BFF (Backend-for-Frontend).

### Business Context
- Monitors temperature in grain stocks (3 layers: bottom, mid, top)
- Monitors humidity (in the middle layer)
- Five measurement spots in each stock
- Supports multiple parallel grain stocks (currently 2 device sets)
- Data flow: Devices → MQTT → Sink Service → InfluxDB → BFF → Frontend
- Replaces Grafana dashboards with custom application

### Infrastructure
- InfluxDB: Time-series database (not publicly accessible)
- MQTT Broker: Device communication
- Sink Service: MQTT to InfluxDB consumer (internal only)
- All services running as Docker containers on a Synology NAS

## Monorepo Structure

| Directory | Purpose | Tech Stack |
|-----------|---------|------------|
| `frontend/` | React PWA | Vite, React 19, TypeScript, Tailwind CSS 4 |
| `backend/` | BFF REST API | Express.js, TypeScript, InfluxDB, JWT |
| `docs/` | Shared documentation | Markdown |

See `frontend/CLAUDE.md` and `backend/CLAUDE.md` for project-specific guidance.

## Code Standards and Conventions

- **Language**: All code, documentation, comments, commit messages, and artefacts must be in English (UK)
- Use British spelling consistently (e.g., "colour", "organise", "behaviour", "initialise")
- **Documentation Philosophy**: Prioritise actionable content over verbose documentation

## Development Environment

- **Package Manager**: npm (workspaces)
- **Node.js**: 22+ (backend requires 22+, frontend requires 20.19+ or 22.12+)

## Running the Project

```bash
# Install all dependencies (both workspaces)
npm install

# Start both frontend and backend in development mode
npm run dev

# Start only frontend (http://localhost:5173)
npm run dev:frontend

# Start only backend (http://localhost:3000)
npm run dev:backend

# Build both projects
npm run build

# Run all tests
npm run test

# Lint all projects
npm run lint

# Type-check all projects
npm run typecheck
```

## Docker

```bash
# Development (includes local InfluxDB)
docker compose up

# Production (connects to existing InfluxDB)
docker compose -f docker-compose.prod.yml up -d
```

## Environment Variables

- Backend: see `backend/.env.example`
- Frontend: see `frontend/.env.example`
