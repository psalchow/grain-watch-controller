# Grainwatch Controller

Backend-for-Frontend service for grain stock monitoring system.

## Quick Links

- [Architecture Decisions](docs/design/DECISIONS.md)
- [Data Model](docs/design/DATA_MODEL.md)
- [API Design](docs/design/API_DESIGN.md)
- [Claude Code Guidance](CLAUDE.md)

## Current Phase

**Design Complete** - Ready for implementation.

## Technology Stack

- **Runtime**: Node.js 24 LTS ('Krypton')
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: InfluxDB (existing) + JSON file for users
- **Query Language**: InfluxQL (SQL-like, not Flux)
- **Authentication**: JWT with bcrypt
- **Authorization**: Role-based (admin/viewer)
- **Deployment**: Docker on Synology NAS

## Design Decisions

✅ TypeScript + Express.js
✅ InfluxQL for database queries (not Flux)
✅ Role-based access control (RBAC)
✅ JSON file for user storage (MVP approach)
✅ JWT authentication
✅ Docker deployment on Synology

## InfluxDB Schema (Confirmed)

- **Organization**: `cornwatch`
- **Bucket**: `cornwatch`
- **Measurement**: `Temp`
- **Tags**: `device-group` (stock ID), `device` (spot ID)
- **Fields**: `temp-top`, `temp-mid`, `temp-bottom`, `humidity`, `batteryMV`, `measurementTimeS`

See [docs/design/DATA_MODEL.md](docs/design/DATA_MODEL.md) for full schema details and [docs/design/INFLUX_QUERIES.md](docs/design/INFLUX_QUERIES.md) for query examples.

## Next Steps

1. ✅ ~~Verify InfluxDB schema~~ - **COMPLETE**
2. **Initialise Node.js project** - package.json, TypeScript configuration
3. **Set up project structure** - Create src/ directories
4. **Implement core services** - InfluxDB client, auth service
5. **Build API endpoints** - Authentication and data query routes
