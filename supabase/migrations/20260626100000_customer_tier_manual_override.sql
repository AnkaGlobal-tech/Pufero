-- Manually assigned tier is protected from automatic recalculation.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tier_manual_override BOOLEAN NOT NULL DEFAULT false;
