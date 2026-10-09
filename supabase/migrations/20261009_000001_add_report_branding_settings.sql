-- Adds the configurable links and support contacts used by generated PDF reports.
-- Safe to re-run on databases where some or all of these columns already exist.
ALTER TABLE public.download_configs
  ADD COLUMN IF NOT EXISTS website_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS support_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS support_email text NOT NULL DEFAULT '';
