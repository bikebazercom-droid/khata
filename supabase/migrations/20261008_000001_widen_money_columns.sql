-- Widen monetary columns for large ledger amounts.
-- Apply only to the intended BanglaKhata Supabase database.
-- This migration is prepared for the production pipeline; it has not been
-- executed from this workspace.
--
-- The current schema defines these fields as NUMERIC(20,2). Increasing the
-- precision preserves existing values and supports amounts beyond NUMERIC(12,2).

BEGIN;

ALTER TABLE public.ledger_entries
  ALTER COLUMN amount TYPE NUMERIC(20, 2)
  USING amount::NUMERIC(20, 2);

ALTER TABLE public.parties
  ALTER COLUMN current_balance TYPE NUMERIC(20, 2)
  USING current_balance::NUMERIC(20, 2);

ALTER TABLE public.business_settings
  ALTER COLUMN online_collection_balance TYPE NUMERIC(20, 2)
  USING online_collection_balance::NUMERIC(20, 2);

DO $verify_money_column_precision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ledger_entries'
      AND column_name = 'amount'
      AND data_type = 'numeric'
      AND numeric_precision = 20
      AND numeric_scale = 2
  ) THEN
    RAISE EXCEPTION 'ledger_entries.amount is not NUMERIC(20,2)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parties'
      AND column_name = 'current_balance'
      AND data_type = 'numeric'
      AND numeric_precision = 20
      AND numeric_scale = 2
  ) THEN
    RAISE EXCEPTION 'parties.current_balance is not NUMERIC(20,2)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_settings'
      AND column_name = 'online_collection_balance'
      AND data_type = 'numeric'
      AND numeric_precision = 20
      AND numeric_scale = 2
  ) THEN
    RAISE EXCEPTION 'business_settings.online_collection_balance is not NUMERIC(20,2)';
  END IF;
END;
$verify_money_column_precision$;

COMMIT;
