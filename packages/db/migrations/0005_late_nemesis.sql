CREATE TABLE "vm" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"hatchvm_id" text NOT NULL,
	"host" text,
	"ssh_port" integer DEFAULT 22,
	"ssh_private_key" text NOT NULL,
	"ssh_public_key" text NOT NULL,
	"last_active_at" timestamp DEFAULT now(),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vm" ADD CONSTRAINT "vm_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;