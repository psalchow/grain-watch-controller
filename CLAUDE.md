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

### Operating Reality

This context decides how much machinery a feature deserves. Reviewers should
weigh findings against it rather than against a worst case that cannot occur
here.

- **Seasonal.** Ventilation matters from August to May, with the bulk between
  September and February. After that the stock is at temperature.
- **Installations are stable.** A hall is fitted with fan control once and keeps
  it for years. Withdrawing it is a rare, planned change, not an operation.
- **People are present.** Storage and ventilation are supervised. A change to
  the installation happens with somebody on site who can look at the fan.
- **The Shelly is the safety net.** It switches off by itself after roughly one
  to two hours without a keep-alive signal from the backend, so the backend does
  not have to chase acknowledgements to leave the plant in a safe state.

Consequently: prefer the simple path. One best-effort command plus the device's
own auto-off beats a retry loop with acknowledgement tracking. Complexity is
only justified where it protects against something that actually happens in a
season.

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

## Versioning

The PWA and the BFF ship as one Docker image, so there is **one** product
version: the `version` field in the root `package.json`. The workspace manifests
carry no version.

- Bump: `npm version <major|minor|patch> --no-git-tag-version` in the root
- Backend reports it at `GET /health` (reads the root manifest at runtime)
- Frontend gets it injected at build time as `__APP_VERSION__` (see `frontend/appVersion.ts`)
- `scripts/build-prod-image.sh` derives the image tag from it
- Both versions are visible in the app-info dialog (info icon in the header);
  a mismatch means the browser is still running a cached bundle

## Scope Discipline and Backlog

Work the task as leanly as it can be done. A task grows only when the growth
belongs to it.

**Fix inside the current task:**
- what the task asks for, including the unstated parts a careful reader would
  assume
- clarifications where the request was vague — ask rather than guess when the
  answers lead to materially different work
- review findings that concern the code this task touches and are defects,
  contradictions, or unsafe behaviour in it

**Put in `docs/BACKLOG.md` instead:**
- pre-existing weaknesses the task merely walks past
- new capabilities suggested by a finding ("while you are here, add X")
- follow-up work created by a deliberate decision (migrations to defer,
  configuration that needs a UI, wording that needs a redesign)

When it is unclear which side a finding falls on, ask: fix now or backlog? Do
not decide it by fixing it.

Before starting a feature, read `docs/BACKLOG.md` and pick up the entries that
belong to the same area — a backlog item is cheapest to clear while its code is
already open. Entries may also be worked off in dedicated rounds.

**For reviewers (human or agent):** report findings with the same split. Mark
each one as *in scope* (a defect in the code under review) or *backlog*
(everything else), so out-of-scope observations are recorded rather than
repaired on the spot. Repeating a finding the author has already resolved as a
deliberate, documented decision is noise — check `docs/BACKLOG.md` and the
relevant spec first.

## Branching

Work on `main` directly. A single stream of work needs no branch, and a feature
branch that is only ever merged by its own author is overhead.

Parallel features are the exception: give each one its own branch in its own
`git worktree`, so the working copies cannot interfere. Merge back into `main`
and remove the worktree when the feature lands.

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

# Regenerate the PWA icon set after changing frontend/src/brand/wheatmarkGeometry.ts
npm run icons
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
