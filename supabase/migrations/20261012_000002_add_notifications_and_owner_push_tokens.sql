CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  party_id uuid,
  party_name text,
  entry_id uuid,
  entry_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_recipient_business_created_idx
  ON public.notifications (recipient_user_id, business_id, created_at);

CREATE TABLE IF NOT EXISTS public.owner_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_push_tokens_token_unique
  ON public.owner_push_tokens (token);
CREATE INDEX IF NOT EXISTS owner_push_tokens_user_id_idx
  ON public.owner_push_tokens (user_id);
