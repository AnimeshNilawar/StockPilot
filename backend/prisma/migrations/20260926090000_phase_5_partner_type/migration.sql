-- Partners gain a business role: goods arrive from a SUPPLIER, leave to a
-- CUSTOMER, and one counterparty can be both. Existing rows default to BOTH so
-- no partner becomes unusable for either document type during the backfill.
ALTER TABLE "partners" ADD COLUMN "partner_type" TEXT NOT NULL DEFAULT 'BOTH';

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_partner_type_check"
  CHECK ("partner_type" IN ('SUPPLIER', 'CUSTOMER', 'BOTH'));

-- Dropdowns filter by role, so the type is part of every partner lookup.
CREATE INDEX "partners_partner_type_idx" ON "partners" ("partner_type");
