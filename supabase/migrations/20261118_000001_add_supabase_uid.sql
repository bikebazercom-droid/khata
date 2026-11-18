ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS supabase_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_supabase_uid_unique_idx
  ON app_users (supabase_uid)
  WHERE supabase_uid IS NOT NULL;
