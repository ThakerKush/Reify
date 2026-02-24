import { type InferSelectModel } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  varchar,
  json,
  serial,
  integer,
} from "drizzle-orm/pg-core";

// Better Auth Core Tables
export const user = pgTable("user", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const session = pgTable("session", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type Session = InferSelectModel<typeof session>;

export const account = pgTable("account", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  idToken: text("idToken"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type Account = InferSelectModel<typeof account>;

export const verification = pgTable("verification", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type Verification = InferSelectModel<typeof verification>;

export const chat = pgTable("Chat", {
  id: serial("id").notNull().primaryKey(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  title: text("title"),
  userId: integer("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
  projectId: integer("projectId").references(() => project.id),
  uuid: uuid("uuid").notNull(),
});
export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  id: serial("id").primaryKey().notNull(),
  messageUuid: uuid("messageUuid").notNull().unique(),
  chatId: integer("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export type Message = InferSelectModel<typeof message>;

export const project = pgTable("projects", {
  id: serial("id").primaryKey().notNull(),
  userId: integer("userId")
    .notNull()
    .references(() => user.id),
  uuid: uuid("uuid").notNull(),
  storageLink: text("storageLink"),
  lastHeartbeat: timestamp("last_heartbeat").defaultNow(),
  workspaceStatus: varchar("workspace_status", {
    enum: ["inactive", "active", "archiving"],
  }).default("inactive"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export type Project = InferSelectModel<typeof project>;

export const vm = pgTable("vm", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  hatchvmId: text("hatchvm_id").notNull(),       // ID from your hatchvm API
  host: text("host"),                              // IP or hostname
  sshPort: integer("ssh_port").default(22),
  sshPrivateKey: text("ssh_private_key").notNull(), // ed25519 private key
  sshPublicKey: text("ssh_public_key").notNull(),   // corresponding public key
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type Vm = InferSelectModel<typeof vm>;