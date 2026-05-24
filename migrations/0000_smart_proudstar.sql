CREATE TABLE "messages" (
	"id" integer PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"content" text NOT NULL,
	"chat_id" text NOT NULL,
	"reply_to_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	"link_preview" jsonb
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" integer NOT NULL,
	"emoji" text NOT NULL,
	"username" text NOT NULL,
	CONSTRAINT "reactions_message_id_emoji_username_pk" PRIMARY KEY("message_id","emoji","username")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
