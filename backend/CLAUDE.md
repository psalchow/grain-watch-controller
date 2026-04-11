# Backend CLAUDE.md

Backend-specific guidance for the Grainwatch BFF service. See root `CLAUDE.md` for shared conventions.

## Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | 22+ |
| Framework | Express.js | 4.x |
| Language | TypeScript | 5.7+ |
| Database | InfluxDB 2.x | InfluxQL |
| Auth | JWT + bcrypt | - |
| Validation | Zod | 3.x |
| Testing | Jest + Supertest | - |

## Architecture Rules

- **InfluxDB Queries**: Use InfluxQL (SQL-like syntax), NOT Flux
- **Configuration**: All InfluxDB settings (org, bucket, measurement) must come from environment variables — NEVER hardcode
- **Security**: Use parameterised queries or proper escaping to prevent injection attacks

## Project Structure

```
backend/
├── src/
│   ├── app.ts              # Express app setup
│   ├── bootstrap.ts         # Initialisation logic
│   ├── index.ts            # Entry point
│   ├── config/             # Configuration
│   ├── controllers/        # HTTP request handlers
│   ├── middleware/          # Express middleware (auth, errors, validation)
│   ├── models/             # TypeScript types
│   ├── routes/             # API routes
│   ├── services/           # Business logic (InfluxDB, auth)
│   └── types/              # TypeScript type definitions
├── tests/                   # Jest tests
├── package.json
├── tsconfig.json
├── jest.config.js
├── Dockerfile
└── .env.example
```

## Running

```bash
# From monorepo root
npm run dev:backend

# Or from this directory
npm run dev

# Tests
npm test
npm run test:coverage

# Type checking
npm run typecheck
```

## Deployment

Docker-based deployment on Synology NAS. See `docs/DEPLOYMENT.md`.
