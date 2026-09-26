# StockPilot

Full-stack inventory management system for tracking stock, warehouses, operations, and real-time inventory movements.

**Control your inventory. Track every movement.**

## Project Overview

StockPilot is a production-ready application for modern inventory management. This repository currently contains the Phase 1 implementation.

### Phase 1 Features: Authentication & RBAC
- **Authentication**: JWT access tokens, HttpOnly Refresh Token rotation, Argon2 password hashing.
- **RBAC**: Admin, Inventory Manager, and Warehouse Staff roles with permission-based middleware.
- **OTP Password Reset**: 6-digit OTP reset flow with lockouts and token revocation.
- **Audit Logging**: Tracks critical user mutations in the database.
- **Security & Local OTP**: Since this is a fully offline application without email services, OTP codes for password reset are printed to the backend console when running in development mode. Look for `[DEV ONLY] OTP for <email>: <code_here>` in your terminal output.

## Architecture Overview

- **Frontend**: React, Vite, React Router, Tailwind CSS, TanStack Query
- **Backend**: Node.js, Express, Prisma ORM
- **Database**: PostgreSQL 16
- **Infrastructure**: Docker Compose

## Repository Structure

```
StockPilot/
├── backend/       # Node.js/Express API with Prisma
├── frontend/      # React SPA
├── docker-compose.yml
└── README.md
```

## Local Prerequisites

- Node.js >= 20
- Docker and Docker Compose

## Environment Variables

Copy `.env.example` to `.env` in the root folder before starting up (or just use docker compose which handles defaults).

## Docker Setup

The primary way to run the application locally is via Docker Compose.

```bash
docker compose up -d
```

This will start:
- PostgreSQL (port 5432)
- Backend API (port 3000)
- Frontend App (port 5173)

## Migration Workflow

Database migrations are managed by Prisma in the `backend/prisma` directory. 
In future phases, run:
```bash
npx prisma migrate dev
```

## Setup without Docker (Local Development)

### Database
Start a local PostgreSQL instance and set your `DATABASE_URL` in `backend/.env`.

### Backend
```bash
cd backend
npm install
npm run dev
```
API Health Endpoint: `GET /api/v1/health`

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Local Quality Checks

Instead of remote CI, this project relies on local validation.

### Linting
```bash
cd backend && npm run lint
cd ../frontend && npm run lint
```

### Testing
```bash
cd backend
npm test
```

### Frontend Build
```bash
cd frontend
npm run build
```

### Database Management
Validate Prisma Schema:
```bash
cd backend
npx prisma validate
```

Run Migrations:
```bash
cd backend
npx prisma migrate dev
```

Seed Database (Creates default roles and Admin account):
```bash
cd backend
npx prisma db seed
```
