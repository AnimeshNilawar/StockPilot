-- CreateTable
CREATE TABLE "stock_moves" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "to_location_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "scheduled_date" TIMESTAMP(3),
    "done_date" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_quants" (
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "on_hand" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_quants_pkey" PRIMARY KEY ("product_id","location_id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" TEXT,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_moves_product_id_state_idx" ON "stock_moves"("product_id", "state");

-- CreateIndex
CREATE INDEX "stock_moves_document_type_document_id_idx" ON "stock_moves"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "stock_moves_from_location_id_to_location_id_done_date_idx" ON "stock_moves"("from_location_id", "to_location_id", "done_date");

-- CreateIndex
CREATE INDEX "stock_quants_location_id_idx" ON "stock_quants"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions (Prisma's DSL cannot express these).
-- ---------------------------------------------------------------------------

-- The state machine vocabulary is enforced in the database, not just in
-- application code: a stray lowercase value from a script or an ad-hoc query
-- would otherwise split the ledger's history in two.
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_state_check"
  CHECK ("state" IN ('DRAFT', 'WAITING', 'READY', 'DONE', 'CANCELLED'));

ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_document_type_check"
  CHECK ("document_type" IN ('RECEIPT', 'DELIVERY', 'INTERNAL', 'ADJUSTMENT'));

-- A move is meaningless without both endpoints, and its quantity is positive.
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_quantity_check"
  CHECK ("quantity" > 0);

-- Only a completed move may carry a done_date.
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_done_date_check"
  CHECK ("done_date" IS NULL OR "state" = 'DONE');

-- Document reference counter. `nextval` is atomic, so two concurrent document
-- creates can never be handed the same reference (RCP-000001, DLV-000002, ...).
CREATE SEQUENCE IF NOT EXISTS "document_reference_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

-- The ledger is append-only: a completed move can never be rewritten or removed.
CREATE OR REPLACE FUNCTION stock_moves_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."state" = 'DONE' AND (NEW."state" <> 'DONE'
     OR NEW."quantity" <> OLD."quantity"
     OR NEW."product_id" <> OLD."product_id"
     OR NEW."from_location_id" <> OLD."from_location_id"
     OR NEW."to_location_id" <> OLD."to_location_id") THEN
    RAISE EXCEPTION 'completed stock moves are immutable (move %)', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_moves_immutable_trigger
  BEFORE UPDATE ON "stock_moves"
  FOR EACH ROW EXECUTE FUNCTION stock_moves_immutable();

-- Stock can never go negative, and a reservation can never exceed the balance
-- it is reserved against. Belt-and-braces behind the engine's own guards.
CREATE OR REPLACE FUNCTION stock_quants_non_negative() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."on_hand" < 0 THEN
    RAISE EXCEPTION 'negative on_hand for product % at location %', NEW."product_id", NEW."location_id";
  END IF;
  IF NEW."reserved_quantity" < 0 THEN
    RAISE EXCEPTION 'negative reserved_quantity for product % at location %', NEW."product_id", NEW."location_id";
  END IF;
  IF NEW."reserved_quantity" > NEW."on_hand" THEN
    RAISE EXCEPTION 'reservation % exceeds on_hand % for product % at location %',
      NEW."reserved_quantity", NEW."on_hand", NEW."product_id", NEW."location_id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_quants_non_negative_trigger
  BEFORE INSERT OR UPDATE ON "stock_quants"
  FOR EACH ROW EXECUTE FUNCTION stock_quants_non_negative();
