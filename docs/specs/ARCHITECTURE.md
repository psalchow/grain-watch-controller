# Architecture

## Business Context

Grainwatch monitors temperature and humidity in grain stocks to prevent spoilage. Each stock has 5 measurement spots. Each spot measures temperature at 3 layers (bottom, mid, top). Humidity sensors are optional — some device sets include them (measuring at the mid layer), others do not.

The system supports multiple parallel grain stocks (currently 2 device sets). Sensor devices send data via MQTT to a sink service, which writes to InfluxDB. InfluxDB, MQTT broker, and sink service run as Docker containers on a Synology NAS within a private network.

This BFF service replaces Grafana dashboards with a custom application tailored to the operators' needs. It sits between the web/mobile frontends and InfluxDB, providing authentication, authorisation, and a data API.

## System Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Web/      │────▶│  Grainwatch  │────▶│  InfluxDB   │
│   Mobile    │     │  Controller  │     │  (private)  │
│   Frontend  │◀────│  (BFF API)   │◀────│             │
└─────────────┘     └──────────────┘     └─────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ User Database│
                    │ (JSON file)  │
                    └──────────────┘
```

## Technology Stack

- **Runtime**: Node.js 24 LTS ('Krypton')
- **Language**: TypeScript 5.x
- **Web Framework**: Express.js
- **InfluxDB**: InfluxQL via v1 compatibility API (no external client library)
- **Authentication**: JWT (jsonwebtoken) + bcrypt
- **Validation**: Zod
- **Security**: Helmet, CORS
- **Logging**: Morgan
- **Testing**: Jest + Supertest
- **Build**: TypeScript compiler (tsc)
- **Deployment**: Docker container on Synology NAS

## Deployment Architecture

```
Synology Docker Network:
├── influxdb (existing)
├── mqtt-broker (existing)
├── sink-service (existing)
└── grainwatch-controller (new)
    ├── Port: 3000 (internal)
    ├── Reverse Proxy: 443 → 3000 (optional)
    └── Network: Same as InfluxDB (for access)
```
