# StockPilot

Full-stack inventory management system for tracking stock, warehouses, operations, and real-time inventory movements.

**Control your inventory. Track every movement.**

## Project Overview

StockPilot is a production-ready application for modern inventory management. This repository contains the Phase 1, Phase 2, and Phase 3 implementations. Document workflows (receipts, deliveries, internal transfers, adjustments) land in later phases; the engine they will sit on is already in place.

### Phase 1 Features: Authentication & RBAC
- **Authentication**: JWT access tokens, HttpOnly Refresh Token rotation, Argon2 password hashing.
- **RBAC**: Admin, Inventory Manager, and Warehouse Staff roles with permission-based middleware.
- **OTP Password Reset**: 6-digit OTP reset flow with lockouts and token revocation.
- **Audit Logging**: Tracks critical user mutations in the database.
- **Security & Local OTP**: Since this is a fully offline application without email services, OTP codes for password reset are printed to the backend console when running in development mode. Look for `[DEV ONLY] OTP for <email>: <code_here>` in your terminal output.

### Phase 2 Features: Catalog, Warehouses & Locations
- **Products**: SKU, name, description, UOM, optional category, reorder thresholds, and active flag. UOM codes are normalised to upper case.
- **Categories**: Single parent per category, forming a tree with cycle prevention on write and an `GET /categories/tree` read model.
- **Units of Measure**: Unique code plus precision, kept immutable once a product references it.
- **Warehouses**: Unique short code, name, optional address, and active flag. `WAREHOUSE_STAFF` only ever see their assigned warehouses.
- **Locations**: Nested inside a warehouse via an optional parent, with a short code that is unique per warehouse. Types are split into stock-holding and boundary roles (see below).
- **Scoped Access**: Listing, reading, writing, and deleting a warehouse or a location is checked against the caller's warehouse assignments, so an unassigned warehouse returns `403` rather than leaking its existence.

### Phase 3 Features: Inventory Engine & Ledger
- **Cached Balances**: `stock_quants` holds one row per product/location with `on_hand` and `reserved_quantity`. Balance reads never touch the ledger.
- **Immutable Ledger**: Every stock mutation appends a `stock_moves` row. A database trigger rejects any `UPDATE`, so corrections are new compensating rows rather than edits.
- **Reservations**: `freeToUse = onHand - reservedQuantity`. Reserve, release, and consume operations run under a row lock and can never drive free stock below zero.
- **Reconciliation**: `GET /stock/reconcile` recomputes balances from the ledger and reports drift, so the cache can be audited at any time.
- **Idempotency**: `POST /moves` requires an `Idempotency-Key` header. The key is claimed inside the business transaction, so a replay returns the original result (`200` with `Idempotent-Replay: true`) and a failed business transaction leaves no key behind to poison retries.
- **Reference Numbers**: Receipts, deliveries, internal transfers, and adjustments get gap-free, prefixed, sequence-backed references (`RCP-000001`, `DLV-000001`, `TRF-000001`, `ADJ-000001`).
- **Read-Only UI**: Stock balances and move history are exposed in the frontend; creating movements is API-only until the document screens arrive in later phases.

## Architecture Overview

- **Frontend**: React, Vite, React Router, Tailwind CSS, TanStack Query
- **Backend**: Node.js, Express, Prisma ORM
- **Database**: PostgreSQL (Docker Compose pins 16; a local 18 server is verified to work)
- **Infrastructure**: Docker Compose

## Repository Structure

```
StockPilot/
├── backend/       # Node.js/Express API with Prisma
├── frontend/      # React SPA
├── docker-compose.yml
└── README.md
```

## Location Types and Movement Rules

Location types decide whether a location can hold a balance, and the engine enforces the rules below before any row is written:

| Type | Holds stock | Role in a movement |
| --- | --- | --- |
| `INTERNAL` | yes | Ordinary storage; both ends of an internal move |
| `PRODUCTION` | yes | Consumes from stock, produces into stock |
| `SCRAP` | yes | Terminal sink; cannot be a source |
| `TRANSIT` | yes | In-transit staging between warehouses |
| `VENDOR` | no | Boundary; a receipt removes from the vendor side only |
| `CUSTOMER` | no | Boundary; a delivery adds to the customer side only |

Boundary locations never get a `stock_quants` row, which is what makes a receipt `VENDOR -> INTERNAL` and a delivery `INTERNAL -> CUSTOMER` conserve only the holding side. Internal moves require both ends to be stock-holding locations and the source and destination warehouses must match.

## API Surface

All routes are namespaced under `/api/v1` and authenticated with a bearer access token. Unknown paths return `404` rather than `401`, because authentication is applied per feature router.

### Phase 1

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | public |
| POST | `/auth/forgot-password`, `/auth/reset-password` | public |
| GET | `/auth/me` | authenticated |
| GET/POST/PATCH/DELETE | `/users` | `user.manage` |

### Phase 2

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/products`, `/products/:id` | `product.read` |
| POST/PATCH/DELETE | `/products`, `/products/:id` | `product.write` |
| GET | `/categories`, `/categories/:id`, `/categories/tree` | `product.read` |
| POST/PATCH/DELETE | `/categories`, `/categories/:id` | `product.write` |
| GET | `/uoms`, `/uoms/options`, `/uoms/:id` | `product.read` |
| POST/PATCH/DELETE | `/uoms`, `/uoms/:id` | `product.write` |
| GET | `/warehouses`, `/warehouses/options`, `/warehouses/:id` | `warehouse.read` |
| POST/PATCH/DELETE | `/warehouses`, `/warehouses/:id` | `warehouse.write` |
| GET | `/warehouses/:id/locations`, `/locations`, `/locations/options` | `location.read` |
| POST/PATCH/DELETE | `/locations`, `/locations/:id` | `location.write` |

### Phase 3

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/stock` | `stock.read` |
| GET | `/stock/summary` | `stock.read` |
| GET | `/stock/low-stock` | `stock.read` |
| GET | `/stock/reconcile` | `stock.read` |
| GET | `/moves`, `/moves/:id` | `stock.read` or `move_history.view` |
| POST | `/moves` | `stock.move` + `Idempotency-Key` header |

`POST /moves` is the direct-movement path used by tests and tooling. The document type is inferred from the endpoint location types, and can be overridden with an explicit `documentType`:

```bash
curl -X POST localhost:3000/api/v1/moves \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: any-unique-string' \
  -d '{
        "productId": "<uuid>",
        "fromLocationId": "<vendor or internal uuid>",
        "toLocationId": "<internal or customer uuid>",
        "quantity": "12.5",
        "reason": "initial intake"
      }'
```

The first call returns `201` with a generated reference; repeating it with the same key returns `200` with the same reference and the `Idempotent-Replay: true` header.

## Local Prerequisites

- Node.js >= 20
- Docker and Docker Compose

## Environment Variables

There are two environment files, and they are used for different things:

- `backend/.env` is read by the backend when you run it directly. Copy `backend/.env.example` to `backend/.env`. It needs at least `DATABASE_URL`; `JWT_SECRET` has an insecure development fallback, so always set your own outside local development.
- The root `.env` is only used by Docker Compose for the `POSTGRES_*` defaults and port wiring. Copy `.env.example` to `.env` if you want to change them.

The frontend reads `VITE_API_BASE_URL` and defaults to `/api/v1` — a path on its own origin, which the Vite dev server proxies to `http://localhost:3000`. Because nothing is hardcoded to `localhost`, that keeps working when the app is opened through `127.0.0.1`, a LAN address, or a tunnel, and it means development never depends on CORS. Set `VITE_API_BASE_URL` to an absolute URL to bypass the proxy (the Docker frontend does this), and `VITE_API_PROXY_TARGET` if the API is not on port 3000.

### CORS

The API allows the SPA's origin with credentials, because the refresh token is an httpOnly cookie. `FRONTEND_URL` sets the canonical browser origin. Outside production, any port on a loopback or private address (`localhost`, `127.0.0.1`, `192.168.x.x`, …) is also accepted, so you can open the app however you like. For anything else — a tunnel, a preview domain — list the origins explicitly:

```bash
FRONTEND_URL=https://app.example.com        # canonical origin
FRONTEND_URLS=https://app.example.com,https://preview.example.com   # extras
```

A disallowed origin is answered without the `Access-Control-Allow-Origin` header rather than a 500, which is how a browser is meant to learn it was denied.

## Password Reset Email Configuration

StockPilot supports two modes for delivering password reset OTPs.

### Offline / Local Mode (Default)
`OTP_DELIVERY_MODE=console`
When working completely offline, the application will intercept the 6-digit OTP and print it directly into the backend development terminal. No external network is required.

### Gmail SMTP Mode (Optional)
`OTP_DELIVERY_MODE=smtp`
The backend can optionally send OTPs through Gmail SMTP. To use this, you must configure a Google App Password (do NOT use your standard Gmail password).

Required variables in `.env`:
```env
OTP_DELIVERY_MODE=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=your-email@gmail.com
```
*Note: Gmail SMTP is strictly an optional development transport. The StockPilot application remains locally hosted.*

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

Database migrations are managed by Prisma in the `backend/prisma` directory. The repository ships one migration per phase and they are applied in order:

| Migration | Contents |
| --- | --- |
| `20260926040946_phase_1_auth_rbac_audit` | users, roles, permissions, warehouse access, refresh tokens, OTP reset, audit log |
| `20260926050000_phase_2_catalog_warehouse_location` | categories, UOM, products, locations, plus lookup indexes |
| `20260926060000_phase_3_inventory_engine` | stock moves, cached quants, idempotency keys, reference sequence, ledger and quant triggers |

Create a migration while iterating:
```bash
npx prisma migrate dev
```

To rebuild the local database from scratch, which is the quickest way to clear rows left behind by test runs:
```bash
npx prisma migrate reset --force   # drops, re-applies every migration, re-seeds
```

Table naming is mixed on purpose: the Phase 1 tables keep their original Prisma defaults (`"User"`, `"Warehouse"`, …) while Phase 2 and 3 tables are mapped to snake_case (`products`, `locations`, `stock_moves`, …). Phase 2's `locations.warehouse_id` therefore references `"Warehouse"("id")`.

## Setup without Docker (Local Development)

### Database
Start a local PostgreSQL instance and set your `DATABASE_URL` in `backend/.env` (copy `backend/.env.example` to get started). The verified local connection is:

```
postgresql://stockpilot:stockpilot_password@127.0.0.1:5432/stockpilot_db?schema=public
```

Apply migrations and seed before the first run:

```bash
cd backend
npx prisma migrate deploy   # or `npx prisma migrate dev` while iterating
npx prisma db seed
```

The seed creates 3 roles, 22 permissions, one admin user, 8 units of measure, 6 categories, 3 products, and a `MAIN` warehouse with 6 locations. Admin credentials: `admin@stockpilot.local` / `Admin@1234` (change immediately outside local development).

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

Frontend routes: `/login`, `/dashboard`, `/products`, `/categories`, `/uoms`, `/warehouses`, `/warehouses/:warehouseId/locations`, `/stock`, `/moves`, `/health`. Everything except the auth screens and `/health` requires a session; individual screens also gate themselves on the permissions returned by `/auth/me`.

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

115 tests across 7 suites: auth and RBAC, catalog, warehouses and locations, the inventory engine, security, and the warehouse isolation checks. The inventory suite covers the invariants that matter most — lock ordering, `freeToUse` never going negative, internal conservation, ledger immutability, idempotent replay, reconciliation drift, and a parallel-move race that fails if a quant update is lost.

Tests run against the real database using the `DATABASE_URL` in `backend/.env`, and they create their own fixtures. They clean up after themselves but can leave rows behind, so run `npx prisma migrate reset --force` afterwards if you want a pristine development database.

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
npx prisma db seed
```

## Demo Credentials

The following demo accounts are provided for **DEVELOPMENT / DEMO ONLY**:

- **Admin**: `admin@stockpilot.local` / `Admin@12345`
- **Inventory Manager**: `manager@stockpilot.local` / `Manager@12345`
- **Warehouse Staff**: `staff@stockpilot.local` / `Staff@12345`

Do not use these credentials in a production environment.

## Demo Data

To populate the database with a realistic, idempotent demo dataset containing products, warehouses, and generated stock movements:

```bash
cd backend
npx prisma db seed
```

You can verify the seeded data by running:

```bash
cd backend
npm run db:verify-demo
```

### Main Scenarios Available:
1. **Authentication & RBAC**: Log in with different roles to verify Dashboard access and Warehouse isolation (Staff can only see Pune Main Warehouse).
2. **Receipt Validations**: Navigate to Receipts, find the `DRAFT` receipt, and validate it to see stock levels instantly increase.
3. **Idempotency**: Observe how double-validation requests securely return cached responses without duplicating `StockMove` records.
4. **Move History**: Check the Move History screen to see generated internal transfers and completed receipts.
