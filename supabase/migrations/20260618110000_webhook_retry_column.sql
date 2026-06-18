ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_events_retry
  ON webhook_events(status, next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;
