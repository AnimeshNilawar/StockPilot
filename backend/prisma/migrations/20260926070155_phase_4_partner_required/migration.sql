/*
  Warnings:

  - Made the column `partner_id` on table `receipts` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_partner_id_fkey";

-- AlterTable
ALTER TABLE "receipts" ALTER COLUMN "partner_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
