-- App Settings table for indexer heartbeats and system configuration
-- Used by deposit indexer to store liveness data

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster value queries
CREATE INDEX IF NOT EXISTS idx_app_settings_value ON public.app_settings USING gin(value);

-- RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access, public read-only
DROP POLICY IF EXISTS "app_settings: service role full access" ON public.app_settings;
CREATE POLICY "app_settings: service role full access" 
  ON public.app_settings FOR ALL
  USING (
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 
      ''
    ) = 'service_role'
  );

DROP POLICY IF EXISTS "app_settings: public read" ON public.app_settings;
CREATE POLICY "app_settings: public read" 
  ON public.app_settings FOR SELECT
  USING (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Comments
COMMENT ON TABLE public.app_settings IS 'System configuration and indexer heartbeat tracking';
COMMENT ON COLUMN public.app_settings.key IS 'Setting key (e.g., deposit_indexer_heartbeat)';
COMMENT ON COLUMN public.app_settings.value IS 'JSONB value for flexible data storage';