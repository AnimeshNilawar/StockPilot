-- CreateTable
CREATE TABLE "internal_transfers" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_transfer_lines" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_location_id" TEXT NOT NULL,
    "destination_location_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "internal_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "created_by" TEXT,
    "validated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_lines" (
    "id" TEXT NOT NULL,
    "adjustment_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "system_quantity" DECIMAL(14,4) NOT NULL,
    "counted_quantity" DECIMAL(14,4) NOT NULL,
    "difference" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_transfers_reference_key" ON "internal_transfers"("reference");

-- CreateIndex
CREATE INDEX "internal_transfers_warehouse_id_state_idx" ON "internal_transfers"("warehouse_id", "state");

-- CreateIndex
CREATE INDEX "internal_transfer_lines_transfer_id_idx" ON "internal_transfer_lines"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "adjustments_reference_key" ON "adjustments"("reference");

-- CreateIndex
CREATE INDEX "adjustments_warehouse_id_state_idx" ON "adjustments"("warehouse_id", "state");

-- CreateIndex
CREATE INDEX "adjustment_lines_adjustment_id_idx" ON "adjustment_lines"("adjustment_id");

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_lines" ADD CONSTRAINT "internal_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "internal_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_lines" ADD CONSTRAINT "internal_transfer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_lines" ADD CONSTRAINT "internal_transfer_lines_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_lines" ADD CONSTRAINT "internal_transfer_lines_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions (Prisma's DSL cannot express these).
-- ---------------------------------------------------------------------------

ALTER TABLE "internal_transfers"
  ADD CONSTRAINT "internal_transfers_state_check"
  CHECK ("state" IN ('DRAFT', 'WAITING', 'READY', 'DONE', 'CANCELLED'));

ALTER TABLE "internal_transfer_lines"
  ADD CONSTRAINT "internal_transfer_lines_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "internal_transfer_lines"
  ADD CONSTRAINT "internal_transfer_lines_diff_locations_check"
  CHECK ("source_location_id" <> "destination_location_id");

ALTER TABLE "adjustments"
  ADD CONSTRAINT "adjustments_state_check"
  CHECK ("state" IN ('DRAFT', 'WAITING', 'READY', 'DONE', 'CANCELLED'));

ALTER TABLE "adjustment_lines"
  ADD CONSTRAINT "adjustment_lines_system_qty_check"
  CHECK ("system_quantity" >= 0);

ALTER TABLE "adjustment_lines"
  ADD CONSTRAINT "adjustment_lines_counted_qty_check"
  CHECK ("counted_quantity" >= 0);

