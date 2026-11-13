CREATE TYPE "off_day" AS ENUM('SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI');--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM('pending', 'paid', 'cancelled', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('pending', 'successful', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "seat_status" AS ENUM('available', 'reserved', 'booked');--> statement-breakpoint
CREATE TYPE "seat_type" AS ENUM('s_chair', 'snigdha', 'ac_s', 'ac_c');--> statement-breakpoint
CREATE TYPE "ticket_status" AS ENUM('valid', 'used', 'cancelled');--> statement-breakpoint
CREATE TYPE "trip_status" AS ENUM('scheduled', 'cancelled', 'departed', 'completed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"train_id" uuid NOT NULL,
	"journey_date" date NOT NULL,
	"departs_at" timestamp with time zone NOT NULL,
	"sales_open_at" timestamp with time zone NOT NULL,
	"status" "trip_status" DEFAULT 'scheduled'::"trip_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_seat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trip_id" uuid NOT NULL,
	"coach_code" text NOT NULL,
	"seat_number" integer NOT NULL,
	"seat_type" "seat_type" NOT NULL,
	"price" integer NOT NULL,
	"status" "seat_status" DEFAULT 'available'::"seat_status" NOT NULL,
	"order_id" uuid,
	"reserved_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_seat_price_positive" CHECK ("price" >= 0),
	CONSTRAINT "trip_seat_order_consistent" CHECK (("status" = 'available') = ("order_id" IS NULL)),
	CONSTRAINT "trip_seat_reservation_expires" CHECK ("status" <> 'reserved' OR "reserved_until" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "coach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"train_id" uuid NOT NULL,
	"code" text NOT NULL,
	"seat_type" "seat_type" NOT NULL,
	"seat_count" integer NOT NULL,
	"price" integer NOT NULL,
	CONSTRAINT "coach_seat_count_positive" CHECK ("seat_count" > 0),
	CONSTRAINT "coach_price_positive" CHECK ("price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "train" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"from_station" text NOT NULL,
	"to_station" text NOT NULL,
	"departure_time" time NOT NULL,
	"arrival_time" time NOT NULL,
	"arrival_day_offset" integer DEFAULT 0 NOT NULL,
	"off_day" "off_day",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "train_arrival_offset_valid" CHECK ("arrival_day_offset" >= 0),
	CONSTRAINT "train_route_valid" CHECK ("from_station" <> "to_station")
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'pending'::"order_status" NOT NULL,
	"total_amount" integer NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_total_positive" CHECK ("total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending'::"payment_status" NOT NULL,
	"provider" text NOT NULL,
	"transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"trip_seat_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"passenger_name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"code" text NOT NULL,
	"status" "ticket_status" DEFAULT 'valid'::"ticket_status" NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_price_positive" CHECK ("unit_price" >= 0)
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_train_date_uq" ON "trip" ("train_id","journey_date");--> statement-breakpoint
CREATE INDEX "trip_date_status_idx" ON "trip" ("journey_date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_seat_position_uq" ON "trip_seat" ("trip_id","coach_code","seat_number");--> statement-breakpoint
CREATE INDEX "trip_seat_availability_idx" ON "trip_seat" ("trip_id","seat_type","status");--> statement-breakpoint
CREATE INDEX "trip_seat_expiry_idx" ON "trip_seat" ("status","reserved_until");--> statement-breakpoint
CREATE INDEX "trip_seat_order_idx" ON "trip_seat" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_train_code_uq" ON "coach" ("train_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "train_number_uq" ON "train" ("number");--> statement-breakpoint
CREATE INDEX "train_route_idx" ON "train" ("from_station","to_station");--> statement-breakpoint
CREATE UNIQUE INDEX "order_user_idempotency_uq" ON "order" ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_user_created_idx" ON "order" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_expires_idx" ON "order" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "order_trip_idx" ON "order" ("trip_id");--> statement-breakpoint
CREATE INDEX "payment_order_idx" ON "payment" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_txn_uq" ON "payment" ("provider","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_code_uq" ON "ticket" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_seat_active_uq" ON "ticket" ("trip_seat_id") WHERE "status" in ('valid', 'used');--> statement-breakpoint
CREATE INDEX "ticket_order_idx" ON "ticket" ("order_id");--> statement-breakpoint
CREATE INDEX "ticket_user_idx" ON "ticket" ("user_id");--> statement-breakpoint
CREATE INDEX "ticket_trip_idx" ON "ticket" ("trip_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_train_id_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "train"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "trip_seat" ADD CONSTRAINT "trip_seat_trip_id_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "trip_seat" ADD CONSTRAINT "trip_seat_order_id_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "coach" ADD CONSTRAINT "coach_train_id_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "train"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_trip_id_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_order_id_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_trip_id_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_trip_seat_id_trip_seat_id_fkey" FOREIGN KEY ("trip_seat_id") REFERENCES "trip_seat"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;