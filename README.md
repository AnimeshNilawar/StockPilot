# StockPilot

Full-stack inventory management system for tracking stock, warehouses, operations, and real-time inventory movements.

**Control your inventory. Track every movement.**

## Project Overview

StockPilot is a production-ready application for modern inventory management. This repository contains the Phase 1 through Phase 5 implementations: authentication and RBAC, the catalog, the inventory engine, partners and the receipt document, and deliveries with stock reservations. Internal transfer and adjustment *documents* land in later phases; the engine and the state rules they need are already in place.

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

### Phase 4 Features: Partners, Typed Roles & the Receipt Document
- **Partners**: A counterparty record with a unique name and an active flag. Existing free-text `receipts.supplier` values were backfilled into partners, then the column was dropped in favour of `receipts.partner_id`, which is `RESTRICT` — a receipt cannot outlive its partner.
- **Multi-Line Receipts**: A receipt carries many `receipt_lines`, each naming a product, a quantity, and the destination location inside the receiving warehouse.
- **Gap-Free References**: `RCP-000001` style references are sequence-backed, so a receipt number is never reused or skipped.
- **Warehouse Scoping**: Receipts are filtered and authorised against the caller's warehouse assignments, not just the document's own state. Only warehouse-scoped roles are pinned to their assignments, so an Inventory Manager still sees every warehouse.
- **Partner Roles**: Every partner is a `SUPPLIER`, a `CUSTOMER`, or `BOTH`, enforced by a database `CHECK` constraint and indexed for role-filtered dropdowns. The migration defaults existing rows to `BOTH` so no counterparty becomes unusable during the backfill. A dropdown filtered to a concrete role returns that role *and* `BOTH` — a `BOTH` partner can genuinely serve either document.
- **Partner API**: `GET /partners` is paginated and searchable, `GET /partners/options` is the unpaginated active-only list the dropdowns use, and a partner referenced by any receipt or delivery cannot be deleted (`409 PARTNER_IN_USE`).
- **Shared State Rules**: Document lifecycle rules live in `src/domain/documentState.js` and are enforced by `src/services/document.service.js`, so every document type inherits the same state machine instead of re-deriving it.
- **Atomic Validation**: Validating a document posts its stock movement *and* flips it to `DONE` in a single transaction. The state write is a compare-and-set on `{ id, state }`, so two operators validating at the same moment cannot both post; the loser gets `409 DOCUMENT_STATE_CONFLICT` and the winning transaction is never partially applied.
- **Adjustment Semantics**: An adjustment is a stock *correction*, so it may only run between ordinary stock and the scrap bin — write-off is stock → `SCRAP`, write-back is `SCRAP` → stock. `SCRAP` is itself stock-holding, so the rule is "exactly one side is `SCRAP`": a move between two scrap bins is a transfer, and posting it as a correction would launder a quantity discrepancy into a write-off.
- **Inference Is Deliberately Asymmetric**: the ad-hoc move endpoint infers holding → `SCRAP` as an adjustment, but `SCRAP` → holding as an internal transfer, because posting a write-back is a conscious choice rather than something a type guess can justify. Callers post a write-back with an explicit `documentType`.
- **UI**: Receipt list, receipt detail, and an A4 print view, all driven by the paginated API.

### Phase 5 Features: Deliveries & Stock Reservations
- **Deliveries**: A delivery carries many `delivery_lines`, each naming a product, a quantity, and the `sourceLocationId` the goods ship from. The source must be a stock-holding location inside the delivery's own warehouse — a `VENDOR` or `CUSTOMER` boundary node never holds a balance, so naming one as a source is rejected at creation rather than failing at pick time. A delivery is goods going *out*, so its partner must be a `CUSTOMER` or `BOTH`.
- **Picking Is How Stock Is Claimed**: Outbound stock is contended, so a delivery must reserve its units before it ships them. `POST /deliveries/:id/pick` claims the quantity against free-to-use, and `READY` is reachable *only* that way. The document's state is therefore the single record of whether a reservation exists, so the two can never disagree.
- **Validation Consumes the Claim**: Validating posts one ledger row per line from the source location to the warehouse's `CUSTOMER` boundary node, consuming the reservation in the same write. Because reserved stock is excluded from free-to-use, this path checks availability against `onHand` instead — otherwise a fully reserved delivery could never ship. The reservation must still be present, or the document would be consuming stock it never reserved.
- **Cancellation Releases the Claim**: Cancelling a `READY` delivery unwinds its reservations transactionally, returning the units to free stock. It is not a separate step an operator can forget, which would strand a real claim on real stock. The release takes the quant row locks before the state write, so a concurrent validation is serialised rather than interleaved and whichever loses the state compare-and-set rolls its own work back.
- **Enforced in the Database**: A `deliveries_must_be_picked` trigger rejects any `UPDATE` that sets `DONE` unless the previous state was `READY`, so a delivery cannot reach a shipped state without a reservation ever having existed — even if a future caller reaches the table directly.
- **Deterministic Lock Order**: Lines are aggregated per (product, location) and processed in a fixed order, because the engine locks quant rows in ascending id order. Without that ordering, two deliveries whose lines overlap in a different order could deadlock against each other.
- **Availability Preview**: `GET /deliveries/:id/availability` reports on-hand, reserved, and free-to-use per line, so an operator can see whether a delivery can be picked before being refused. A `READY` delivery counts back its own claim, so a picked delivery never reports itself as broken.
- **Permissions**: `delivery.pick` is separate from `delivery.edit` because picking is the step that first affects anyone else's ability to ship. Warehouse Staff may create, edit, and pick, but not validate.
- **UI**: Delivery list, delivery detail with a stock-availability panel, and an A4 delivery note.


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
| `SCRAP` | yes | Terminal sink; a source only for an explicit adjustment write-back |
| `TRANSIT` | yes | In-transit staging between warehouses |
| `VENDOR` | no | Boundary; a receipt removes from the vendor side only |
| `CUSTOMER` | no | Boundary; a delivery adds to the customer side only |

Boundary locations never get a `stock_quants` row, which is what makes a receipt `VENDOR -> INTERNAL` and a delivery `INTERNAL -> CUSTOMER` conserve only the holding side. Internal moves require both ends to be stock-holding locations and the source and destination warehouses must match.

`SCRAP` is stock-holding, so `isStockHolding` alone cannot tell a write-off from a move between two scrap bins. The adjustment rule therefore uses `isOrdinaryHolding` — stock-holding *other than* `SCRAP` — to require exactly one scrap side. `SCRAP -> SCRAP` and `SCRAP -> INTERNAL` are still perfectly good internal transfers; they just cannot be posted as adjustments.

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

### Phase 4

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/partners` | `product.read` |
| GET | `/partners/options?type=SUPPLIER\|CUSTOMER` | `product.read` |
| GET | `/partners/:id` | `product.read` |
| POST | `/partners` | `product.write` |
| PATCH | `/partners/:id` | `product.write` |
| DELETE | `/partners/:id` | `product.write` |
| GET | `/receipts` | authenticated, warehouse-scoped |
| GET | `/receipts/:id` | authenticated, warehouse-scoped |
| POST | `/receipts` | `receipt.create` |
| PUT | `/receipts/:id` | `receipt.edit` |
| PATCH | `/receipts/:id/status` | `receipt.edit` |
| POST | `/receipts/:id/cancel` | `receipt.edit` |
| POST | `/receipts/:id/validate` | `receipt.validate` + `Idempotency-Key` header |

Partners are master data, so they reuse the catalogue's `product.read` / `product.write` permissions rather than growing a parallel set of actions. Receipts get their own `receipt.create`, `receipt.edit`, and `receipt.validate` actions, because approving a document that moves stock is a meaningfully different risk from editing a draft.

`GET /partners/options` is deliberately not paginated — it exists to fill a dropdown, and a picker that silently returns the first page of partners is a data-loss bug. `GET /partners` remains paginated for the admin listing.

Receipt lifecycle:

```
DRAFT ──► WAITING ──► READY ──► (validate) ──► DONE
  └──────────────► CANCELLED
```

Validation posts the stock movement and the state change in one transaction, guarded by a compare-and-set on the state it read. A concurrent second validation loses the compare-and-set and receives `409 DOCUMENT_STATE_CONIFICT` rather than posting the goods twice.

### Phase 5

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/deliveries` | authenticated, warehouse-scoped |
| GET | `/deliveries/:id` | authenticated, warehouse-scoped |
| GET | `/deliveries/:id/availability` | authenticated, warehouse-scoped |
| POST | `/deliveries` | `delivery.create` |
| PUT | `/deliveries/:id` | `delivery.edit` |
| PATCH | `/deliveries/:id/status` | `delivery.edit` |
| POST | `/deliveries/:id/pick` | `delivery.pick` |
| POST | `/deliveries/:id/cancel` | `delivery.edit` |
| POST | `/deliveries/:id/validate` | `delivery.validate` + `Idempotency-Key` header |

Delivery lifecycle:

```
DRAFT ──► WAITING ──► (pick) ──► READY ──► (validate) ──► DONE
  └──────────────────┴──────────────┴──────────────────► CANCELLED
```

Two rules make this different from a receipt:

- **`PATCH /deliveries/:id/status` only accepts `WAITING`.** `READY` is reachable only by picking, because picking is what creates the reservation. Letting a caller set the state directly would allow a delivery to reach validation without ever holding a claim on stock. A database trigger enforces the same rule from the other side by rejecting any `DONE` whose previous state was not `READY`.
- **Editing is `DRAFT`-only.** From `WAITING` on, the line quantities may already describe a live claim on real stock, so changing them would leave that claim describing goods nobody is shipping.

`delivery.pick` is separate from `delivery.edit` because picking is the first moment a delivery affects anyone else's ability to ship. Warehouse Staff hold `delivery.create`, `delivery.edit`, and `delivery.pick`, but not `delivery.validate`.

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

Frontend routes: `/login`, `/dashboard`, `/products`, `/categories`, `/uoms`, `/warehouses`, `/warehouses/:warehouseId/locations`, `/receipts`, `/receipts/:id`, `/stock`, `/moves`, `/health`. Everything except the auth screens and `/health` requires a session; individual screens also gate themselves on the permissions returned by `/auth/me`.

Partners are API-only for now: the receipt screens consume `/partners/options` for their supplier dropdown, but there is no partner admin screen yet, so partners are created with `POST /partners`.

## Local Quality Checks

Every check below also runs in CI on push and pull request, against a real PostgreSQL 16 service rather than a stub.

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

15 suites, 240 tests: authentication and RBAC, the catalog, warehouses and locations, the inventory engine, security, warehouse isolation, receipts, partners, the shared document state spine, the adjustment location rules, and deliveries.

The suites need the database to be seeded, even though they create their own fixtures: they look roles and permissions up by name and use the seeded demo users as their access-denial cases. A database that has had only `npx prisma migrate deploy` run against it fails with `Seed role missing: INVENTORY_MANAGER`. The seed itself is idempotent, so running it before a test run is safe.

The inventory suite covers the invariants that matter most — lock ordering, `freeToUse` never going negative, internal conservation, ledger immutability, idempotent replay, reconciliation drift, and a parallel-move race that fails if a quant update is lost. The document suite adds a deterministic race: one transaction holds a row lock while a second tries to validate the same receipt, and the test asserts the loser gets a conflict rather than double-posting. That test was verified to fail if the state write is replaced with a read-then-write, so it is guarding a real behaviour rather than restating the implementation.

The delivery suite (42 tests) covers the reservation lifecycle specifically: two deliveries competing for the same free-to-use stock cannot both be picked, cancelling a `READY` delivery returns its units to free stock, validating requires both the on-hand quantity and the delivery's own reservation, and a delivery belonging to another warehouse is invisible rather than merely forbidden. It also checks that the per-line availability preview matches what picking will actually do, including when a delivery lists the same product and location on two lines.

Tests run against the real database using the `DATABASE_URL` in `backend/.env`, and they create their own fixtures. Suites that go through `tests/helpers.js` register what they create — including rows created through the HTTP API — and `cleanupFixtures()` removes them in foreign-key order after the suite, so repeated runs leave the database unchanged.

Some older suites still create fixtures without registering them. Those runs will accumulate rows, so if you want a pristine development database, `npx prisma migrate reset --force` afterwards — but note that this drops any hand-created data along with the test residue.

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
3. **Delivery Reservations**: Open a `WAITING` delivery and pick it — the reserved quantity rises and the units leave free stock while on-hand is unchanged. Then validate it to watch the on-hand quantity fall and the reservation clear.
4. **Delivery Availability**: On a delivery that is not yet picked, the availability panel shows on-hand, reserved, and free-to-use per line, so you can see why a pick would be refused before attempting it.
5. **Cancellation**: Cancel a `READY` delivery and watch the reserved quantity return to free stock, proving the claim is released rather than stranded.
6. **Permissions**: Log in as Warehouse Staff and confirm the Validate action is absent — picking is allowed, shipping is not.
7. **Idempotency**: Validate a document twice with the same `Idempotency-Key` and observe the second call return the original result with `Idempotent-Replay: true` instead of duplicating `StockMove` records.
8. **Move History**: Check the Move History screen to see generated internal transfers, completed receipts, and shipped deliveries.
