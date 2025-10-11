import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/log.js";
import { createNodeWebSocket } from "@hono/node-ws";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { sessionContext } from "../session/sessionContext.js";
import { convertModelMessage } from "../utils/convertModelMessage.js";
import { ChatMessage, WsClientMessages } from "./types.js";
import { authMiddleware } from "../middleware/auth.js";
import { router } from "../trpc/trpc.js";
import { trpcServer } from "@hono/trpc-server";
import { getChatInfo } from "../services/db.js";
import { setupFileWatcher, listFiles } from "../services/docker.js";
import { getSessionContext } from "../services/workspaceManager.js";
import {
  createNewWorkspace,
  ensureWorkspaceReady,
  createAIStream,
  saveMessages,
  handleFileChangeEvent,
  handleWebSocketMessage,
} from "./chatHandler.js";

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

      const result = await createNewWorkspace(
        userId,
        projectId,
        chatId,
        imageName
      );

      if (!result.ok) {
        log.error(
          { route: "/chat/new", error: result.error },
          "Failed to create new workspace"
        );
        return c.json({ error: result.error }, 500);
      }

      return c.json({ success: true, chatId });
    }
  )
  .get("/chat/:chatId/messages", authMiddleware, async (c) => {
    try {
      const chatId = c.req.param("chatId");
      const user = c.get("user");

      log.info({ chatId, userId: user.id }, "Fetching messages for chat");

      const chatInfo = await getChatInfo(user.id, chatId);
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

        // Get chat info
        const chatInfoResult = await getChatInfo(userId, chatId);
        if (!chatInfoResult.ok) {
          log.error(
            { route: "/chat", error: chatInfoResult.error },
            "Error when getting chat info"
          );
          return c.json({ error: chatInfoResult.error }, 500);
        }

        const { messages: dbMessages, chat, project } = chatInfoResult.value;
        const messages = convertModelMessage(dbMessages);
        const projectId = project?.uuid!;

        // Create AI stream
        const aiStream = await sessionContext.run(
          getSessionContext(projectId) || {
            projectId,
            workspaceInfo: null as any,
          },
          async () => {
            const stream = createUIMessageStream<ChatMessage>({
              execute: async ({ writer: dataStream }) => {
                // Ensure workspace is ready
                const contextResult = await ensureWorkspaceReady(
                  projectId,
                  dataStream
                );

                if (!contextResult.ok) {
                  log.error(contextResult.error, "Failed to prepare workspace");
                  dataStream.write({
                    type: "data-workspace",
                    data: {
                      status: "error",
                      message: "Failed to restore workspace",
                    },
                    transient: true,
                  });
                  throw new Error("Failed to prepare workspace");
                }

                // Create and merge AI stream
                const result = await createAIStream(
                  messages,
                  message,
                  modelProvider,
                  model,
                  dataStream
                );
                dataStream.merge(result.toUIMessageStream());
              },
              onFinish: async (event) => {
                if (event.messages && event.responseMessage) {
                  await saveMessages(
                    chat.id,
                    message,
                    messageId,
                    event.responseMessage
                  );
                }
              },
            });

            return createUIMessageStreamResponse({ stream });
          }
        );

        return aiStream;
      } catch (error) {
        log.error(error, "Error when processing chat");
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  )
  .get(
    "/ws/:chatId",
    upgradeWebSocket(async (c) => {
      const chatId = c.req.param("chatId");
      const userId = Number(c.req.query("userId"));

      log.info({ chatId, userId }, "WebSocket connection attempt");

      // Get chat and container info
      const chatResult = await getChatInfo(userId, chatId);
      if (!chatResult.ok) {
        log.error(chatResult.error, "Failed to get chat info for WebSocket");
        throw new Error(chatResult.error.message);
      }

      const containerId = chatResult.value.project?.uuid!;
      const stream = await setupFileWatcher(containerId);

      return {
        async onOpen(event, ws) {
          // Set up file watcher
          stream.on("data", async (chunk) => {
            const output = chunk.toString().trim();
            const [event, filePath] = output.split(" ", 2);
            await handleFileChangeEvent(event, filePath, containerId, ws);
          });

          // Send initial file list
          const filesResult = await listFiles(containerId);
          if (filesResult.ok) {
            ws.send(
              JSON.stringify({
                type: "initial_files",
                files: filesResult.value,
              })
            );
          } else {
            log.error(
              filesResult.error,
              "Failed to list files on WebSocket open"
            );
            ws.send(
              JSON.stringify({ type: "error", message: "Failed to list files" })
            );
          }
        },

        async onMessage(event, ws) {
          try {
            const msg: WsClientMessages = JSON.parse(event.data.toString());
            log.info({ type: msg.type }, "Received WebSocket message");
            await handleWebSocketMessage(msg, containerId, ws);
          } catch (error) {
            log.error(error, "Error handling WebSocket message");
            ws.send(
              JSON.stringify({ type: "error", message: "Invalid message" })
            );
          }
        },
      };
    })
  );

export { app, injectWebSocket };
