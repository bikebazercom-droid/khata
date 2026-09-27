CREATE TYPE "public"."login_source" AS ENUM('play_store', 'app_store', 'web');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."balance_type" AS ENUM('YOU_WILL_GIVE', 'YOU_WILL_GET');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('CUSTOMER', 'SUPPLIER');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('YOU_GAVE', 'YOU_GOT');--> statement-breakpoint
CREATE TYPE "public"."worker_invite_status" AS ENUM('pending', 'claimed', 'revoked');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'আমার খাতা' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user_login_sessions" (
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "app_user_login_sessions_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"phone" text,
	"verified_email" text,
	"phone_session_version" integer DEFAULT 0 NOT NULL,
	"business_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"login_source" "login_source" DEFAULT 'web',
	"device_meta" text DEFAULT '',
	"last_login" timestamp with time zone,
	"last_logout" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"worker_access_deleted_at" timestamp with time zone,
	"adjustment_party_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "app_users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "app_users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"role" "party_role" NOT NULL,
	"current_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance_type" "balance_type" DEFAULT 'YOU_WILL_GET' NOT NULL,
	"due_date" date,
	"last_transaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"type" "ledger_entry_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"bill_reference" text,
	"bill_image" text,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"transfer_party_id" uuid,
	"linked_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ledger_request_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"source_entry" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"store_name" text DEFAULT 'আমার খাতা' NOT NULL,
	"language" text DEFAULT 'English' NOT NULL,
	"online_collection_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "business_settings_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "staff_personnel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"queue_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_deployment_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_id" uuid,
	"staff_name" text NOT NULL,
	"destination" text NOT NULL,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_businesses" (
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_businesses_user_id_business_id_pk" PRIMARY KEY("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "worker_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text,
	"phone" text,
	"party_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adjustment_party_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "worker_invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "worker_party_assignments" (
	"user_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_party_assignments_user_id_party_id_pk" PRIMARY KEY("user_id","party_id")
);
--> statement-breakpoint
CREATE TABLE "admin_otp_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_url" text DEFAULT '' NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"remaining_balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"sender" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_ips" (
	"ip" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"device" text NOT NULL,
	"auth_method" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_presence_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "download_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"android_store_url" text DEFAULT '' NOT NULL,
	"android_apk_url" text DEFAULT '' NOT NULL,
	"ios_store_url" text DEFAULT '' NOT NULL,
	"windows_exe_url" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_user_login_sessions" ADD CONSTRAINT "app_user_login_sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_party_id_parties_id_fk" FOREIGN KEY ("transfer_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_linked_entry_id_ledger_entries_id_fk" FOREIGN KEY ("linked_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_request_receipts" ADD CONSTRAINT "ledger_request_receipts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_personnel" ADD CONSTRAINT "staff_personnel_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_deployment_logs" ADD CONSTRAINT "staff_deployment_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_claimed_user_id_app_users_id_fk" FOREIGN KEY ("claimed_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_party_assignments" ADD CONSTRAINT "worker_party_assignments_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_party_assignments" ADD CONSTRAINT "worker_party_assignments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_login_events" ADD CONSTRAINT "user_login_events_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_request_actor_business_unique" ON "ledger_request_receipts" USING btree ("business_id","actor_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_invites_pending_email_unique" ON "worker_invites" USING btree (lower("email")) WHERE "worker_invites"."status" = 'pending' AND "worker_invites"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_invites_pending_phone_unique" ON "worker_invites" USING btree ("phone") WHERE "worker_invites"."status" = 'pending' AND "worker_invites"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_login_events_user_time_idx" ON "user_login_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "user_login_events_time_idx" ON "user_login_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "user_presence_last_seen_idx" ON "user_presence" USING btree ("last_seen_at");