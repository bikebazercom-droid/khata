ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS firebase_uid text;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_firebase_uid_unique
  ON app_users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;
