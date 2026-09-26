-- DropIndex
DROP INDEX "categories_name_trgm_idx";

-- DropIndex
DROP INDEX "locations_name_trgm_idx";

-- DropIndex
DROP INDEX "products_name_trgm_idx";

-- DropIndex
DROP INDEX "products_sku_trgm_idx";

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "destination_location_id" TEXT NOT NULL,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_reference_key" ON "receipts"("reference");

-- CreateIndex
CREATE INDEX "receipts_warehouse_id_state_idx" ON "receipts"("warehouse_id", "state");

-- CreateIndex
CREATE INDEX "receipt_lines_receipt_id_idx" ON "receipt_lines"("receipt_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
