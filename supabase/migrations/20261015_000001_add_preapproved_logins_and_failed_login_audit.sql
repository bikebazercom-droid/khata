CREATE TABLE IF NOT EXISTS preapproved_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('phone', 'email')),
  identifier text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS preapproved_logins_kind_identifier_idx
  ON preapproved_logins (kind, identifier);

CREATE TABLE IF NOT EXISTS user_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  auth_method text NOT NULL,
  stage text NOT NULL,
  error_code text NOT NULL,
  ip text,
  device text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_login_attempts_time_idx
  ON user_login_attempts (occurred_at);
CREATE INDEX IF NOT EXISTS user_login_attempts_identifier_time_idx
  ON user_login_attempts (identifier, occurred_at);
