-- Add the PostgreSQL-backed OTP rate-limit counter table to an existing database.
-- Safe to run more than once; it does not drop or alter existing data.
CREATE TABLE IF NOT EXISTS public.otp_rate_limit_counters (
  scope text NOT NULL,
  key_hash text NOT NULL,
  total_hits integer NOT NULL,
  reset_at timestamp with time zone NOT NULL,
  CONSTRAINT otp_rate_limit_counters_scope_key_hash_pk PRIMARY KEY (scope, key_hash)
);

CREATE INDEX IF NOT EXISTS otp_rate_limit_counters_reset_at_idx
  ON public.otp_rate_limit_counters USING btree (reset_at);