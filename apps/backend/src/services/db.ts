import config from "../config/index.js";
import { BaseError } from "../errors/baseError.js";
import { logger } from "../utils/log.js";
import postgres, { type Sql } from "postgres";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "@repo/db/schema";
import { Err, Ok, type Result } from "../errors/result.js";

export class DbError extends BaseError {
  operation: string;
  details?: Record<string, unknown>;

  constructor(
    operation: string,
    message: string,
    details?: Record<string, unknown>,
    source = "db-service"
  ) {
    super("DB_ERROR", message, source);
    this.operation = operation;
    this.details = details;
  }

  public static connectionFailed(message: string): DbError {
    return new DbError("connection", message, {}, "db-service");
  }

  public static queryFailed(query: string, error: unknown): DbError {
    return new DbError(
      "query",
      `Query failed: ${query}`,
      { error },
      "db-service"
    );
  }

  public static notFound(resource: string, identifier: string): DbError {
    return new DbError("not_found", `${resource} not found`, { identifier });
  }

  public static validationError(message: string): DbError {
    return new DbError("validation", message);
  }
}
// let dbConnection: Sql = postgres({
//     user: config.db.POSTGRES_USER,
//     password: config.db.POSTGRES_PASSWORD,
//     host: config.db.POSTGRES_HOST,
//     port: Number(config.db.POSTGRES_PORT),
//     database: config.db.POSTGRES_DB,
//   });

//   db = drizzle(dbConnection, { schema });
const log = logger.child({ service: "db" });
export let dbConnection: Sql;
export let db: PostgresJsDatabase<typeof schema>;

export const setupDb = async () => {
  dbConnection = postgres({
    user: config.db.POSTGRES_USER,
    password: config.db.POSTGRES_PASSWORD,
    host: config.db.POSTGRES_HOST,
    port: Number(config.db.POSTGRES_PORT),
    database: config.db.POSTGRES_DB,
  });

  db = drizzle(dbConnection, { schema });
};

export const ping = async (): Promise<boolean> => {
  try {
    await db.execute("SELECT 1");
    return true;
  } catch (error) {
    log.error(error, "Failed to ping databse");
    return false;
  }
};

export const getChatInfo = async (
  userId: number,
  chatUuid: string
): Promise<
  Result<
    {
      messages: schema.Message[];
      chat: schema.Chat;
      project: schema.Project | null;
    },
    DbError
  >
> => {
  try {
    // Single query with JOINs to get chat, messages, and project
    const results = await db
      .select({
        chat: schema.chat,
        project: schema.project,
        message: schema.message,
      })
      .from(schema.chat)
      .leftJoin(schema.project, eq(schema.chat.projectId, schema.project.id))
      .leftJoin(schema.message, eq(schema.message.chatId, schema.chat.id))
      .where(
        and(eq(schema.chat.uuid, chatUuid), eq(schema.chat.userId, userId))
      )
      .orderBy(schema.message.createdAt);

    if (results.length === 0) {
      return Err(
        DbError.notFound("chat", `userId: ${userId}, chatId: ${chatUuid}`)
      );
    }

    // Extract chat and project (same across all rows)
    const chat = results[0].chat;
    const project = results[0].project;

    // Extract and filter messages (remove nulls from LEFT JOIN)
    const messages = results
      .map((row) => row.message)
      .filter((message): message is schema.Message => message !== null);

    return Ok({ messages, chat, project });
  } catch (error) {
    log.error(error, "Failed to get chat info");
    return Err(DbError.queryFailed("getChatInfo", error));
  }
};

export const getProject = async (
  projectId: string
): Promise<Result<schema.Project, DbError>> => {
  try {
    const project = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.uuid, projectId));
    if (project.length === 0) {
      return Err(DbError.notFound("project", `projectId: ${projectId}`));
    }
    return Ok(project[0]);
  } catch (error) {
    log.error(error, "Failed to get project");
    return Err(DbError.queryFailed("getProject", error));
  }
};

export const insertChat = async (
  chat: Omit<schema.Chat, "id">
): Promise<Result<number, DbError>> => {
  try {
    const chatResult = await db
      .insert(schema.chat)
      .values(chat)
      .returning({ id: schema.chat.id });
    return Ok(chatResult[0].id);
  } catch (error) {
    log.error(error, "Failed to create chat");
    return Err(DbError.queryFailed("createChat", error));
  }
};

export const insertMessage = async (
  chatId: number,
  message: Omit<schema.Message, "id">
): Promise<Result<number, DbError>> => {
  try {
    const chatResult = await db
      .select()
      .from(schema.chat)
      .where(eq(schema.chat.id, chatId));
    if (chatResult.length === 0) {
      return Err(DbError.notFound("chat", `chatId: ${chatId}`));
    }
    const messageResult = await db
      .insert(schema.message)
      .values(message)
      .returning({ id: schema.message.id });
    return Ok(messageResult[0].id);
  } catch (error) {
    log.error(error, "Failed to create message");
    return Err(DbError.queryFailed("createMessage", error));
  }
};

export const insertProject = async (
  projectId: string,
  userId: number
): Promise<Result<number, DbError>> => {
  try {
    const project = await db
      .insert(schema.project)
      .values({
        userId: userId,
        uuid: projectId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.project.id });

    return Ok(project[0].id);
  } catch (error) {
    log.error(error, "Failed to create project");
    return Err(DbError.queryFailed("createProject", error));
  }
};

export const getVmByProjectId = async (
  projectId: number
): Promise<Result<schema.Vm, DbError>> => {
  try {
    const result = await db
      .select()
      .from(schema.vm)
      .where(eq(schema.vm.projectId, projectId))
      .limit(1);

    if (result.length === 0) {
      return Err(DbError.notFound("vm", `projectId: ${projectId}`));
    }
    return Ok(result[0]);
  } catch (error) {
    log.error(error, "Failed to get VM by projectId");
    return Err(DbError.queryFailed("getVmByProjectId", error));
  }
};

export const insertVm = async (vmData: {
  userId: number;
  projectId: number;
  hatchvmId: string;
  host: string;
  sshPort: number;
  sshPrivateKey: string;
  sshPublicKey: string;
}): Promise<Result<schema.Vm, DbError>> => {
  try {
    const result = await db
      .insert(schema.vm)
      .values({
        userId: vmData.userId,
        projectId: vmData.projectId,
        hatchvmId: vmData.hatchvmId,
        host: vmData.host,
        sshPort: vmData.sshPort,
        sshPrivateKey: vmData.sshPrivateKey,
        sshPublicKey: vmData.sshPublicKey,
      })
      .returning();

    return Ok(result[0]);
  } catch (error) {
    log.error(error, "Failed to insert VM");
    return Err(DbError.queryFailed("insertVm", error));
  }
};

export const getSessionByToken = async (
  token: string
): Promise<Result<schema.Session, DbError>> => {
  try {
    const sessionResult = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.token, token))
      .limit(1);

    if (sessionResult.length === 0) {
      return Err(DbError.notFound("Session", token));
    }

    return Ok(sessionResult[0]);
  } catch (error) {
    log.error(error, "Failed to get session by token");
    return Err(DbError.queryFailed("getSessionByToken", error));
  }
};

export const getUser = async (
  userId: number
): Promise<Result<schema.User, DbError>> => {
  try {
    const userResult = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return Err(DbError.notFound("User", userId.toString()));
    }

    return Ok(userResult[0]);
  } catch (error) {
    log.error(error, "Failed to get user by ID");
    return Err(DbError.queryFailed("getUserById", error));
  }
};
