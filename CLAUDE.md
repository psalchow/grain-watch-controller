# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backend-for-Frontend (BFF) service for grain stock monitoring system. Provides REST API for web/mobile frontends with authentication and authorization.

### Business Context
- Monitors temperature in grain stocks (3 layers: bottom, mid, top)
- Monitors humidity (in the middle layer)
- Five measurement spots in each stock
- Supports multiple parallel grain stocks (currently 2 device sets)
- Data flow: Devices → MQTT → Sink Service → InfluxDB (private)
- Replaces Grafana dashboards with custom application

### Current Infrastructure
- InfluxDB: Time-series database (not publicly accessible)
- MQTT Broker: Device communication
- Sink Service: MQTT to InfluxDB consumer (only internally)
- All these services running as docker containers on a Synology

### Service Responsibilities
- Query InfluxDB for temperature/humidity data
- Provide filtered data based on user permissions
- Authentication and authorization
- API for frontend consumption

## Development Environment

- IDE: IntelliJ IDEA
- Language/Framework: TypeScript + Node.js 24 + Express.js
- Runtime: Node.js 24 LTS ('Krypton')
- Package Manager: npm
- Testing: Jest + Supertest
- Deployment: Docker on Synology NAS

## Code Standards and Conventions

- **Language**: All code, documentation, comments, commit messages, and artifacts must be in English (UK)
- Use British spelling consistently (e.g., "colour", "organise", "behaviour", "initialise")
- Follow consistent naming conventions across the codebase
- **Documentation Philosophy**: Prioritise actionable content over verbose documentation. Create concise, practical documents that drive development forward rather than lengthy explanatory texts

## Architecture Rules

- **InfluxDB Queries**: Use InfluxQL (SQL-like syntax), NOT Flux
- **Configuration**: All InfluxDB settings (org, bucket, measurement) must come from environment variables - NEVER hardcode
- **Security**: Use parameterised queries or proper escaping to prevent injection attacks

## Project Structure

```
src/
├── controllers/      # HTTP request handlers
├── services/         # Business logic (InfluxDB, auth)
├── middleware/       # Express middleware
├── models/          # TypeScript types
├── routes/          # API routes
├── config/          # Configuration
└── utils/           # Helpers
```