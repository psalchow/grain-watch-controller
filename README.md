# Grainwatch Controller

Backend-for-Frontend service for grain stock monitoring system.

## Quick Links

- [Architecture Decisions](docs/design/DECISIONS.md)
- [Data Model](docs/design/DATA_MODEL.md)
- [API Design](docs/design/API_DESIGN.md)
- [Claude Code Guidance](CLAUDE.md)

## Current Phase

**✅ Implementation Complete** - Ready for deployment!

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

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your InfluxDB credentials

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
npm start
```

### Docker Deployment

```bash
# Build Docker image
docker build -t grainwatch-controller .

# Run with Docker Compose
docker-compose up -d

# For Synology deployment, see docs/DEPLOYMENT.md
```

## Features Implemented

✅ **Complete REST API** (12 endpoints)
- Authentication (login, token refresh)
- Stock data (list, latest readings, temperature, humidity, summary, battery)
- Admin (user management)

✅ **Services**
- InfluxDB service with InfluxQL queries
- User management with JSON file storage
- JWT authentication with bcrypt

✅ **Security**
- JWT-based authentication
- Role-based access control (admin/viewer)
- Stock-level authorisation
- Input validation with Zod
- Password hashing with bcrypt

✅ **Testing**
- 251 passing unit and integration tests
- 97% code coverage

✅ **Deployment**
- Docker configuration
- Docker Compose for local development
- Synology NAS deployment guide

## API Documentation

See [docs/design/API_DESIGN.md](docs/design/API_DESIGN.md) for complete API specification.

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** Include JWT token in Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

### Example: Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'
```

### Example: Get Latest Readings

```bash
curl -X GET http://localhost:3000/api/v1/stocks/corn-watch-1/latest \
  -H "Authorization: Bearer <your-token>"
```

## Project Structure

```
grainwatch-controller/
├── src/
│   ├── controllers/      # API request handlers
│   ├── services/         # Business logic (InfluxDB, auth)
│   ├── middleware/       # Authentication, validation, errors
│   ├── models/          # TypeScript interfaces
│   ├── routes/          # API route definitions
│   ├── config/          # Environment configuration
│   └── utils/           # Helper functions
├── tests/
│   ├── unit/            # Unit tests
│   └── integration/     # Integration tests
├── docs/
│   ├── design/          # Architecture documentation
│   └── DEPLOYMENT.md    # Deployment guide
├── data/                # User storage (gitignored)
└── Dockerfile           # Production Docker image
```

## Environment Variables

Required environment variables (see `.env.example` for full list):

```bash
# Server
PORT=3000
NODE_ENV=production

# InfluxDB
INFLUX_HOST=influxdb
INFLUX_PORT=8086
INFLUX_DATABASE=cornwatch
INFLUX_MEASUREMENT=Temp
INFLUX_USERNAME=your-username
INFLUX_PASSWORD=your-password

# JWT
JWT_SECRET=your-secret-key-change-this-in-production
JWT_EXPIRES_IN=24h

# User Storage
USER_FILE_PATH=./data/users.json
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for complete deployment instructions for:
- Local development
- Docker deployment
- Synology NAS deployment

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run linter
npm run lint
```
