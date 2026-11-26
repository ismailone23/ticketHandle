ALTER TABLE "ticket" DROP CONSTRAINT "ticket_trip_seat_id_trip_seat_id_fkey";--> statement-breakpoint
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_price_positive";--> statement-breakpoint
DROP INDEX "ticket_seat_active_uq";--> statement-breakpoint
DROP INDEX "ticket_order_idx";--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "passengers" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "refund_amount" integer;--> statement-breakpoint
ALTER TABLE "train" ALTER COLUMN "off_day" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "off_day";--> statement-breakpoint
CREATE TYPE "off_day" AS ENUM('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');--> statement-breakpoint
ALTER TABLE "train" ALTER COLUMN "off_day" SET DATA TYPE "off_day" USING "off_day"::"off_day";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "trip_seat_id";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "passenger_name";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "unit_price";--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_order_uq" ON "ticket" ("order_id");