CREATE TABLE IF NOT EXISTS "event_tags" (
	"event_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "event_tags_event_id_tag_id_pk" PRIMARY KEY("event_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text,
	"description" text,
	"image" text,
	"icon" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"volume" real DEFAULT 0,
	"volume_24hr" real DEFAULT 0,
	"liquidity" real DEFAULT 0,
	"active" boolean DEFAULT true,
	"closed" boolean DEFAULT false,
	"archived" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_tags" (
	"market_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "market_tags_market_id_tag_id_pk" PRIMARY KEY("market_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text,
	"condition_id" text NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"slug" text,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome_token_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome_prices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"best_bid" real,
	"best_ask" real,
	"spread" real,
	"last_trade_price" real,
	"volume" real DEFAULT 0,
	"volume_24hr" real DEFAULT 0,
	"liquidity" real DEFAULT 0,
	"open_interest" real,
	"image" text,
	"icon" text,
	"category" text,
	"end_date_iso" text,
	"active" boolean DEFAULT true,
	"closed" boolean DEFAULT false,
	"archived" boolean DEFAULT false,
	"resolved" boolean DEFAULT false,
	"winning_outcome" integer,
	"price_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "positions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"wallet_address" text NOT NULL,
	"market_id" text NOT NULL,
	"token_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"size" real NOT NULL,
	"avg_price" real,
	"current_price" real,
	"unrealized_pnl" real,
	"realized_pnl" real,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" text NOT NULL,
	"token_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"price" real NOT NULL,
	"source" varchar(20) DEFAULT 'clob'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_state" (
	"entity" text PRIMARY KEY NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_offset" integer DEFAULT 0,
	"last_cursor" text,
	"status" varchar(20) DEFAULT 'idle',
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text,
	"token_id" text NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" real NOT NULL,
	"size" real NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"maker_address" text,
	"taker_address" text,
	"taker_order_id" text,
	"transaction_hash" text,
	"fee_rate_bps" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"username" text,
	"profile_image" text,
	"total_pnl" real DEFAULT 0,
	"total_volume" real DEFAULT 0,
	"trade_count" integer DEFAULT 0,
	"win_count" integer DEFAULT 0,
	"loss_count" integer DEFAULT 0,
	"win_rate" real,
	"first_trade_at" timestamp with time zone,
	"last_trade_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_tags" ADD CONSTRAINT "market_tags_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_tags" ADD CONSTRAINT "market_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_wallet_address_wallets_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("address") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_history" ADD CONSTRAINT "price_history_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_slug_idx" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_active_idx" ON "events" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_volume_idx" ON "events" USING btree ("volume");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_event_id_idx" ON "markets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_condition_id_idx" ON "markets" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_slug_idx" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_category_idx" ON "markets" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_active_idx" ON "markets" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_volume_idx" ON "markets" USING btree ("volume");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_volume_24hr_idx" ON "markets" USING btree ("volume_24hr");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_liquidity_idx" ON "markets" USING btree ("liquidity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_wallet_address_idx" ON "positions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_market_id_idx" ON "positions" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "positions_wallet_market_token_idx" ON "positions" USING btree ("wallet_address","market_id","token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_market_id_idx" ON "price_history" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_token_id_idx" ON "price_history" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_timestamp_idx" ON "price_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_market_timestamp_idx" ON "price_history" USING btree ("market_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_slug_idx" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_market_id_idx" ON "trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_token_id_idx" ON "trades" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_timestamp_idx" ON "trades" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_market_timestamp_idx" ON "trades" USING btree ("market_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_username_idx" ON "wallets" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_total_pnl_idx" ON "wallets" USING btree ("total_pnl");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_total_volume_idx" ON "wallets" USING btree ("total_volume");