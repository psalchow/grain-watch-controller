# Architecture

## Business Context

Grainwatch monitors temperature and humidity in grain stocks to prevent spoilage. Each stock has 5 measurement spots. Each spot measures temperature at 3 layers (bottom, mid, top). Humidity sensors are optional — some device sets include them (measuring at the mid layer), others do not.

The system supports multiple parallel grain stocks (currently 2 device sets). Sensor devices send data via MQTT to a sink service, which writes to InfluxDB. InfluxDB, MQTT broker, and sink service run as Docker containers on a Synology NAS within a private network.

This application replaces Grafana dashboards with a custom PWA tailored to the operators' needs. The BFF sits between the frontend and InfluxDB, providing authentication, authorisation and a data API. Beyond reading measurements it also **controls the ventilation fans** for stocks that have one, talking to Shelly relays over the same MQTT broker.

## System Overview

```
                    ┌─────────────────────────────┐
                    │   Grainwatch (one container) │
┌─────────────┐     │  ┌───────────┐ ┌──────────┐ │     ┌─────────────┐
│  Browser /  │────▶│  │ React PWA │ │ Express  │ │────▶│  InfluxDB   │
│  Installed  │     │  │ (static)  │ │   BFF    │ │◀────│  (private)  │
│     PWA     │◀────│  └───────────┘ └──────────┘ │     └─────────────┘
└─────────────┘     └─────────────┬───────────────┘
                                  │        │
                          ┌───────▼──┐  ┌──▼──────────┐
                          │  SQLite  │  │ MQTT broker │
                          │  (users, │  │  (fan relays,│
                          │  stocks, │  │   sink svc)  │
                          │  fan log)│  └─────────────┘
                          └──────────┘
```

The PWA is built into static assets and served by the BFF from the same origin,
so a single container delivers the whole application. In local development the
two run separately (Vite on 5173, Express on 3000).

## Data Flow

- **Measurements**: devices → MQTT → sink service → InfluxDB → BFF → frontend.
  The BFF queries InfluxDB directly; it never consumes the measurement topics.
- **Fan control**: frontend → BFF → MQTT → Shelly relay, with state and an event
  log persisted in SQLite. Live status reaches the frontend over server-sent
  events. A keep-alive republishes the desired state because the Shelly relays
  have a one-hour Auto-OFF safeguard.
- **Outdoor conditions**: separate InfluxDB measurements for outdoor temperature
  and humidity, queried with a configurable look-back window.

## Technology Stack

### Frontend

- **Framework**: React 19 with TypeScript
- **Build**: Vite; PWA via `vite-plugin-pwa`
- **Routing**: React Router 7
- **Styling**: Tailwind CSS 4
- **Charts**: Recharts
- **HTTP**: Axios; SSE via `@microsoft/fetch-event-source`
- **Testing**: Vitest + Testing Library

### Backend

- **Runtime**: Node.js 22+ (the Docker image builds on Node 24 Alpine)
- **Language**: TypeScript 5.x
- **Web Framework**: Express.js 4
- **Time-series**: InfluxQL via the InfluxDB 2.x v1 compatibility API (no client library)
- **Relational**: SQLite via Drizzle ORM + better-sqlite3, migrations in `backend/drizzle/`
- **Messaging**: MQTT (`mqtt` client) for fan control
- **Authentication**: JWT (jsonwebtoken) + bcrypt
- **Validation**: Zod
- **Security**: Helmet, CORS
- **Logging**: Morgan
- **Testing**: Jest + Supertest
- **Build**: TypeScript compiler (`tsconfig.build.json`)

### Storage Split

InfluxDB holds the time-series measurements and is treated as read-only by this
application. SQLite holds everything the application owns: users, stock
configuration, fan state and the fan event log. Only the SQLite file needs
backing up from this service — see [DEPLOYMENT.md](../DEPLOYMENT.md).

## Backend Structure

| Directory | Responsibility |
|-----------|----------------|
| `controllers/` | HTTP request handling, status codes, error mapping |
| `routes/` | Route definitions, middleware wiring |
| `middleware/` | Authentication, authorisation, Zod validation, error handling |
| `services/auth/` | Login, tokens, password changes, user CRUD |
| `services/influx/` | InfluxQL queries against the measurements |
| `services/stock/` | Stock configuration and metadata |
| `services/fan/` | Fan state machine, Shelly message handling, keep-alive |
| `services/mqtt/` | Broker connection and topic plumbing |
| `db/` | Drizzle schema, repositories, migrations, seeding |

## Deployment Architecture

```
Synology Docker Network:
├── influxdb (existing)
├── mqtt-broker (existing)
├── sink-service (existing)
└── grainwatch-controller (PWA + BFF)
    ├── Port: 3000 (serves both the API and the PWA)
    ├── Volume: /app/data (SQLite database — required for persistence)
    ├── Reverse Proxy: 443 → 3000 (needed for COOKIE_SECURE)
    └── Network: same as InfluxDB and the MQTT broker
```

A local simulation stack (`docker-compose.sim.yml`) runs the production image
against a seeded InfluxDB and a Shelly device emulator. See `sim/README.md`.
