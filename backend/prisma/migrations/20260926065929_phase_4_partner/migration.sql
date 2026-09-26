-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "partner_id" TEXT,
ALTER COLUMN "supplier" DROP NOT NULL;

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_name_key" ON "partners"("name");

-- Data Migration
INSERT INTO "partners" ("id", "name", "updated_at")
SELECT gen_random_uuid()::TEXT, "supplier", CURRENT_TIMESTAMP
FROM "receipts"
WHERE "supplier" IS NOT NULL
GROUP BY "supplier";

UPDATE "receipts" r
SET "partner_id" = p.id
FROM "partners" p
WHERE r."supplier" = p.name;

-- CreateIndex
CREATE INDEX "receipts_partner_id_idx" ON "receipts"("partner_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
