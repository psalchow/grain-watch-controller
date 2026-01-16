# Architecture Decisions

## Technology Stack (Decided)
- **Language**: TypeScript (Node.js runtime)
- **Framework**: Express.js (proven, extensive middleware ecosystem)
- **Database Client**: InfluxDB client with InfluxQL support
- **Query Language**: InfluxQL (SQL-like syntax, not Flux)
- **Auth**: JWT-based authentication
- **API Style**: RESTful
- **Deployment**: Docker container on Synology NAS
- **Runtime**: Node.js 24 LTS ('Krypton')

**Rationale:**
- TypeScript provides type safety and better IDE support
- Express.js mature ecosystem with auth/validation middleware
- **InfluxQL over Flux**: Simpler, SQL-like syntax; familiar to developers; sufficient for time-series queries
- Docker deployment integrates with existing Synology infrastructure
- Direct network access to private InfluxDB container

### 2. Query Language: InfluxQL (Decided)

**Decision**: Use InfluxQL instead of Flux for querying InfluxDB.

**Rationale:**
- **Simplicity**: SQL-like syntax is more familiar and easier to read/write
- **Sufficient**: All required queries (time-series, aggregations, filtering) are supported
- **Performance**: InfluxQL is optimised for simple time-series queries
- **Existing knowledge**: Team already uses InfluxQL in Grafana dashboards
- **Less overhead**: No need to learn Flux's functional programming paradigm

**Example comparison:**
```sql
-- InfluxQL (chosen)
SELECT mean("temp-top")
FROM "Temp"
WHERE "device-group" = 'corn-watch-1' AND time >= '2026-01-15T00:00:00Z'
GROUP BY time(15m), "device"
```

```
// Flux (not chosen)
from(bucket: "cornwatch")
  |> range(start: 2026-01-15T00:00:00Z)
  |> filter(fn: (r) => r["_measurement"] == "Temp")
  |> filter(fn: (r) => r["device-group"] == "corn-watch-1")
  |> aggregateWindow(every: 15m, fn: mean)
```

**Implementation notes:**
- Use InfluxDB v1-compatible client or v1 compatibility API in InfluxDB 2.x
- All database/measurement names must come from environment variables
- Use parameterised queries or proper escaping to prevent injection
- See [INFLUX_QUERIES.md](INFLUX_QUERIES.md) for complete examples

### 3. Authentication & Authorization (Decided)

**Authentication:**
- JWT tokens (stateless, scalable)
- Bcrypt for password hashing
- Token expiry: 24 hours (configurable)

**Authorization Model:**
- **Role-based access control (RBAC)**
  - `admin`: Can view all grain stocks, manage users
  - `viewer`: Can view only assigned grain stocks
- Stock assignments stored per user
- Middleware checks role + stock access for each request

**User Storage:**
- JSON file (`data/users.json`)
- Structure: Array of user objects with credentials and permissions
- Bcrypt-hashed passwords (never store plaintext)
- Easy to migrate to SQLite/PostgreSQL later if needed

**Rationale:**
- JSON file perfect for MVP (simple, version-controllable)
- RBAC provides flexibility without over-engineering
- Easy to add more roles later (e.g., 'operator', 'readonly')

### 4. Deployment
**Considerations:**
- Containerized (Docker)?
- Access to private InfluxDB (network topology)
- Reverse proxy/API gateway?
