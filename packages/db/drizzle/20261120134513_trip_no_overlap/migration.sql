-- A train can't be on two runs at once: active trips of the same train must not overlap in time.
-- btree_gist lets a GiST index compare train_id with "=" alongside the range "&&".
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_no_overlap" EXCLUDE USING gist (
	"train_id" WITH =,
	tsrange(
		"journey_date" + "departure_time",
		("journey_date" + "arrival_day_offset") + "arrival_time",
		'[)'
	) WITH &&
) WHERE ("status" <> 'cancelled');
