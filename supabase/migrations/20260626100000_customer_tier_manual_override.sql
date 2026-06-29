-- Admin tarafindan manuel atanan tier otomatik yeniden hesaplamadan korunur.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tier_manual_override BOOLEAN NOT NULL DEFAULT false;
