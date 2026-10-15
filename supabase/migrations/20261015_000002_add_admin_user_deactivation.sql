ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
