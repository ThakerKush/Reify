import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, DbError, dbService } from "../services/db.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/log.js";
import { dockerService, type WorkspaceInfo } from "../services/docker.js";
import { createNodeWebSocket } from "@hono/node-ws";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  hasToolCall,
  stepCountIs,
  streamText,
  type UserModelMessage,
} from "ai";
import { registery } from "./registry.js";
import { terminalTool } from "../tool/terminal.js";
import {
  sessionContext,
  type SessionContext,
} from "../session/sessionContext.js";
import { read } from "../tool/read.js";
import { createWrite } from "../tool/write.js";
import { edit } from "../tool/edit.js";
import { fin } from "../tool/serve.js";
import { describe } from "../tool/describte.js";
import { stream } from "hono/streaming";
import {
  getSessionContext,
  setSessionContext,
  workspaceManager,
} from "../services/workspaceManager.js";
import { convertModelMessage } from "../utils/convertModelMessage.js";
import { readFileSync } from "fs";
import { ChatMessage, WsClientMessages, WsServerMessages } from "./types.js";
import { join } from "path";
import { Message } from "@repo/db/schema";
import { authMiddleware } from "../middleware/auth.js";
import { publicProcedure, router } from "../trpc/trpc.js";
import { trpcServer } from "@hono/trpc-server";

const appRouter = router({});

export type AppRouter = typeof appRouter;

const app = new Hono();

app.use("/trpc/*", trpcServer({ router: appRouter }));

const log = logger.child({ service: "backend" });
const imageName = "code-workspace:latestV3";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app
  .post(
    "/chat/new",
    zValidator(
      "json",
      z.object({
        userId: z.number(),
        chatId: z.string(),
      })
    ),
    async (c) => {
      const { userId, chatId } = c.req.valid("json");
      const projectId = uuidv4();
      const container = await dockerService.createBaseWorkspace(
        projectId,
        imageName
      );

      if (!container.ok) {
        log.info(
          { route: "/chat", error: container.error },
          "Error when creating container"
        );
        return c.json({ error: container.error }, 500);
      }

      const project = await dbService.insertProject(
        projectId,
        userId,
        "active"
      );
      if (!project.ok) {
        log.info(
          { route: "/chat", error: project.error },
          "Error when creating project"
        );
        // archive project?? or no??
        return c.json({ error: project.error }, 500);
      }

      // Run the agent inside the session context
      const context: SessionContext = {
        projectId,
        workspaceInfo: container.value,
      };
      setSessionContext(projectId, context);
      const chat = await dbService.insertChat({
        userId,
        projectId: project.value,
        title: null,
        visibility: "private",
        uuid: chatId,
        createdAt: new Date(),
      });

      if (!chat.ok) {
        log.info(
          { route: "/chat", error: chat.error },
          "Error when creating chat"
        );
        return c.json({ error: chat.error }, 500);
      }

      return c.json({ success: true, chatId });
    }
  )
  .get("/chat/:chatId/messages", authMiddleware, async (c) => {
    try {
      const chatId = c.req.param("chatId");
      const user = c.get("user");

      log.info({ chatId, userId: user.id }, "Fetching messages for chat");

      const chatInfo = await dbService.getChatInfo(user.id, chatId);
      if (!chatInfo.ok) {
        log.error(
          { chatId, userId: user.id, error: chatInfo.error },
          "Failed to get chat info"
        );
        return c.json({ error: "Chat not found" }, 404);
      }

      // Transform messages to the format expected by the frontend
      const transformedMessages = chatInfo.value.messages.map((message) => ({
        id: message.messageUuid,
        role: message.role,
        parts: message.parts,
        attachments: message.attachments,
        createdAt: message.createdAt,
      }));

      return c.json({
        messages: transformedMessages,
        chat: chatInfo.value.chat,
        project: chatInfo.value.project,
      });
    } catch (error) {
      log.error(error, "Error fetching chat messages");
      return c.json({ error: "Internal server error" }, 500);
    }
  })
  .post(
    "/chat",
    //TODO: add attachment supoprt here
    zValidator(
      "json",
      z.object({
        chatId: z.string().uuid(),
        messageId: z.string().uuid(),
        userId: z.number(),
        message: z.object({
          id: z.string().uuid(),
          role: z.enum(["user"]),
          parts: z.array(partSchema),
        }),
        modelProvider: z.string(),
        model: z.string(),
      })
    ),
    async (c) => {
      try {
        const { userId, chatId, messageId, message, modelProvider, model } =
          c.req.valid("json");

        const messageResult = await dbService.getChatInfo(userId, chatId);
        if (!messageResult.ok) {
          log.error(
            { route: "/chat", error: messageResult.error },
            "Error when getting chat info"
          );
          return c.json({ error: messageResult.error }, 500);
        }
        const messages = convertModelMessage(messageResult.value.messages);
        let context: SessionContext | null = getSessionContext(
          messageResult.value.project?.uuid!
        );

        const aiStrema = await sessionContext.run(
          context || {
            projectId: messageResult.value.project?.uuid!,
            workspaceInfo: null as any, // Will be set once workspace is ready
          },
          async () => {
            const test = createUIMessageStream<ChatMessage>({
              execute: async ({ writer: dataStream }) => {
                // If no context, we need to fetch/restore workspace
                if (!context) {
                  dataStream.write({
                    type: "data-workspace",
                    data: {
                      status: "loading",
                      message: "Checking workspace status",
                    },
                    transient: true,
                  });

                  log.info(`Workspace not in memory, querying docker api`);
                  let workspaceResult = await dockerService.getWorkspace(
                    messageResult.value.project?.uuid!
                  );

                  if (!workspaceResult.ok) {
                    dataStream.write({
                      type: "data-workspace",
                      data: {
                        status: "loading",
                        message: "Restoring workspace",
                      },
                      transient: true,
                    });

                    log.info(
                      `Workspace not found in docker, restoring from s3`
                    );
                    await workspaceManager.restoreWorkspace(
                      messageResult.value.project?.uuid!
                    );

                    workspaceResult = await dockerService.getWorkspace(
                      messageResult.value.project?.uuid!
                    );
                  }

                  if (!workspaceResult.ok) {
                    log.error(
                      workspaceResult.error,
                      "Error when getting workspace"
                    );
                    dataStream.write({
                      type: "data-workspace",
                      data: {
                        status: "error",
                        message: "Failed to restore workspace",
                      },
                      transient: true,
                    });
                    throw new Error(workspaceResult.error.message);
                  }

                  context = {
                    projectId: messageResult.value.project?.uuid!,
                    workspaceInfo: workspaceResult.value,
                  };

                  setSessionContext(
                    messageResult.value.project?.uuid!,
                    context
                  );

                  dataStream.write({
                    type: "data-workspace",
                    data: {
                      status: "ready",
                      message: "Workspace ready",
                    },
                    transient: true,
                  });
                } else {
                  dataStream.write({
                    type: "data-workspace",
                    data: {
                      status: "ready",
                      message: "Workspace active",
                    },
                    transient: true,
                  });
                }

                const result = streamText({
                  model: registery.languageModel(`${modelProvider}:${model}`),
                  system: readFileSync(
                    new URL("../prompts/system.txt", import.meta.url),
                    "utf-8"
                  ),
                  messages: [
                    ...messages,
                    {
                      role: "user",
                      content: message.parts,
                    } as UserModelMessage,
                  ],
                  tools: {
                    terminal: terminalTool({ dataStream }),
                    write: createWrite({ dataStream }),
                    read,
                    edit,
                    describe,
                    fin,
                  },
                });
                dataStream.merge(result.toUIMessageStream());
              },
              onFinish: async (event) => {
                if (event.messages && event.responseMessage) {
                  const userMessage = {
                    chatId: messageResult.value.chat.id,
                    role: message.role,
                    parts: message.parts,
                    attachments: [],
                    messageUuid: messageId,
                    createdAt: new Date(),
                  };
                  const resultMessage = {
                    chatId: messageResult.value.chat.id,
                    messageUuid: uuidv4(),
                    role: event.responseMessage.role,
                    parts: event.responseMessage.parts,
                    attachments: [],
                    createdAt: new Date(),
                  };
                  await dbService.insertMessage(
                    messageResult.value.chat.id,
                    userMessage
                  );
                  await dbService.insertMessage(
                    messageResult.value.chat.id,
                    resultMessage
                  );
                }
              },
            });

            return createUIMessageStreamResponse({ stream: test });
          }
        );
        return aiStrema;
      } catch (error) {
        log.error(error, "Error when running session context");
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  )
  .get(
    "/ws/:chatId",
    upgradeWebSocket(async (c) => {
      const chatId = c.req.param("chatId");
      const userId = Number(c.req.query("userId"));
      console.log("attempting to connect to ws ", userId, chatId);
      let returnMsg: WsServerMessages;
      const chatResult = await dbService.getChatInfo(userId, chatId);
      if (!chatResult.ok) {
        throw new Error(chatResult.error.message);
      }
      const containerId = chatResult.value.project?.uuid!;
      console.log("containerId", containerId);
      const stream = await dockerService.setupFileWatcher(containerId);
      console.log(chatId, userId);

      return {
        async onOpen(event, ws) {
          stream.on("data", async (chunk) => {
            const output = chunk.toString().trim();
            const [event, filePath] = output.split(" ", 2);

            if ((event === "change" || event === "add") && filePath) {
              const relativePath = filePath.replace("/workspace/", "");

              try {
                const content = await dockerService.executeCommand(
                  containerId,
                  ["cat", relativePath]
                );
                console.log("content", content);

                ws.send(
                  JSON.stringify({
                    type: "file_changed",
                    path: relativePath,
                    content: content,
                  })
                );
              } catch (error) {
                console.error("Error reading file:", error);
              }
            }
          });
          constfiles = await dockerService.listFiles(containerId);
          if (!files.ok) {
            console.log("error", files.error);
            ws.send(
              JSON.stringify({ type: "error", message: "Failed to list files" })
            );
            return;
          }
          console.log("files", files.value);

          ws.send(
            JSON.stringify({ type: "initial_files", files: files.value })
          );
        },
        async onMessage(event, ws) {
          const msg: WsClientMessages = JSON.parse(event.data.toString());
          console.log("Received WebSocket message:", msg);

          switch (msg.type) {
            case "terminal_input":
              break;
            case "list_files":
              const files = await dockerService.listFiles(containerId);
              if (!files.ok) {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Failed to list files",
                  })
                );
                return;
              }
              ws.send(
                JSON.stringify({ type: "initial_files", files: files.value })
              );
              break;
            case "read_file":
              console.log("Reading file:", msg.path);
              const file = await dockerService.executeCommand(containerId, [
                "cat",
                msg.path,
              ]);
              if (!file.ok) {
                console.error("Failed to read file:", msg.path, file.error);
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Failed to read file",
                  })
                );
                return;
              }
              const fileContentMsg = {
                type: "file_content",
                path: msg.path,
                content: file.value.stdout,
              };
              console.log(
                "Sending file content for:",
                msg.path,
                "Content length:",
                file.value.stdout.length
              );
              ws.send(JSON.stringify(fileContentMsg));
              break;
            case "write_file":
              const { content, path } = msg;
              const writeResult = await dockerService.executeCommand(
                containerId,
                ["echo", content, ">", path]
              );
              if (!writeResult.ok) {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Failed to write file",
                  })
                );
                return;
              }
              const writeMsg = {
                type: "file_written",
                path,
                content,
              };
              ws.send(JSON.stringify(writeMsg));
              break;
          }
        },
      };
    })
  );

export { app, injectWebSocket };
