-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_lines" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "source_location_id" TEXT NOT NULL,

    CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_reference_key" ON "deliveries"("reference");

-- CreateIndex
CREATE INDEX "deliveries_warehouse_id_state_idx" ON "deliveries"("warehouse_id", "state");

-- CreateIndex
CREATE INDEX "deliveries_partner_id_idx" ON "deliveries"("partner_id");

-- CreateIndex
CREATE INDEX "delivery_lines_delivery_id_idx" ON "delivery_lines"("delivery_id");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions (Prisma's DSL cannot express these).
-- ---------------------------------------------------------------------------

-- Same vocabulary as receipts and stock_moves, enforced in the database so an
-- ad-hoc UPDATE cannot invent a sixth state that the engine's state machine
-- would then reject on the next transition.
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_state_check"
  CHECK ("state" IN ('DRAFT', 'WAITING', 'READY', 'DONE', 'CANCELLED'));

-- A line that ships nothing is not a line. Same rule the ledger enforces on
-- `stock_moves.quantity`.
ALTER TABLE "delivery_lines"
  ADD CONSTRAINT "delivery_lines_quantity_check"
  CHECK ("quantity" > 0);

-- Stock can only leave the building once it has been picked, and cancelling a
-- picked delivery is what returns the claim. Encoding the invariant here means a
-- delivery cannot reach DONE — and therefore cannot consume stock — without
-- having passed through READY.
CREATE OR REPLACE FUNCTION deliveries_must_be_picked() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."state" = 'DONE' AND OLD."state" <> 'READY' THEN
    RAISE EXCEPTION 'delivery % must be READY before it can be validated', NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deliveries_must_be_picked_trigger
  BEFORE UPDATE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION deliveries_must_be_picked();
