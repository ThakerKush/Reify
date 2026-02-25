import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/log.js";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { sessionContext } from "../session/sessionContext.js";
import { convertModelMessage } from "../utils/convertModelMessage.js";
import { ChatMessage } from "./types.js";
import { authMiddleware } from "../middleware/auth.js";
import { router } from "../trpc/trpc.js";
import { trpcServer } from "@hono/trpc-server";
import {
  getChatInfo,
  getVmByProjectId,
  insertVm,
  insertProject,
  getProject,
} from "../services/db.js";
import { createMainAgent } from "../agent/main/main.js";
import * as vmService from "../services/vm.js";
import * as ssh from "../services/ssh.js";
import config from "../config/index.js";
import {
  createProjectChatContext,
  resolveProjectChatContext,
  createAIStream,
  saveMessages,
} from "./chatHandler.js";

const appRouter = router({});

export type AppRouter = typeof appRouter;

const app = new Hono();
const injectWebSocket = (_server: unknown) => {};

// Enable CORS for frontend
app.use(
  "/*",
  cors({
    origin: "http://localhost:3000", // Your frontend URL
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Chat-Id"], // Important! Expose the chatId header
  })
);

app.use("/trpc/*", trpcServer({ router: appRouter }));

const log = logger.child({ service: "backend" });

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

app
  .post(
    "/projects",
    zValidator(
      "json",
      z.object({
        userId: z.number(),
        name: z.string().min(1).max(100),
      })
    ),
    async (c) => {
      const { userId, name } = c.req.valid("json");
      const projectUuid = uuidv4();

      log.info({ userId, projectUuid }, "Creating project");

      // 1. Insert project in DB so VM can be linked one-to-one with project
      const projectResult = await insertProject(projectUuid, userId);
      if (!projectResult.ok) {
        return c.json({ error: "Failed to create project in database" }, 500);
      }

      // 2. Provision a dedicated VM for this project
      const keyResult = vmService.generateSSHKeyPair();
      if (!keyResult.ok) {
        return c.json({ error: "Failed to generate SSH keys" }, 500);
      }

      const vmResult = await vmService.createVM(keyResult.value.publicKeyOpenSSH);
      if (!vmResult.ok) {
        return c.json({ error: vmResult.error.message }, 500);
      }

      const vmInsertResult = await insertVm({
        userId,
        projectId: projectResult.value,
        hatchvmId: vmResult.value.id,
        host: config.hatchvm.sshHost,
        sshPort: vmResult.value.ssh_port,
        sshPrivateKey: keyResult.value.privateKeyOpenSSH,
        sshPublicKey: keyResult.value.publicKeyOpenSSH,
      });

      if (!vmInsertResult.ok) {
        return c.json({ error: "Failed to store VM" }, 500);
      }

      const vm = vmInsertResult.value;
      const projectPath = `/home/relay/projects/${projectUuid}`;

      // 3. Create project directory on VM
      const mkdirResult = await ssh.exec(
        vm.hatchvmId,
        {
          host: vm.host || config.hatchvm.sshHost,
          port: vm.sshPort || 22,
          username: "relay",
          privateKey: vm.sshPrivateKey,
        },
        `mkdir -p ${projectPath}`
      );

      if (!mkdirResult.ok) {
        log.error(mkdirResult.error, "Failed to create project dir on VM");
        return c.json({ error: "Failed to create project directory on VM" }, 500);
      }

      log.info({ projectUuid, vmId: vm.hatchvmId }, "Project created");

      return c.json({
        projectId: projectUuid,
        name,
        vmId: vm.hatchvmId,
        projectPath,
      });
    }
  )
  .post(
    "/projects/:projectId/chat",
    zValidator(
      "json",
      z.object({
        userId: z.number(),
        prompt: z.string().min(1),
      })
    ),
    async (c) => {
      const projectId = c.req.param("projectId");
      const { userId, prompt } = c.req.valid("json");

      // 1. Look up project
      const projectResult = await getProject(projectId);
      if (!projectResult.ok) {
        return c.json({ error: "Project not found" }, 404);
      }

      if (projectResult.value.userId !== userId) {
        return c.json({ error: "Project does not belong to user" }, 403);
      }

      // 2. Look up VM for this project
      const vmResult = await getVmByProjectId(projectResult.value.id);
      if (!vmResult.ok) {
        return c.json({ error: "No VM found for project" }, 404);
      }

      const vm = vmResult.value;
      const projectPath = `/home/relay/projects/${projectId}`;

      const sshConfig = {
        host: vm.host || config.hatchvm.sshHost,
        port: vm.sshPort || 22,
        username: "relay",
        privateKey: vm.sshPrivateKey,
      };

      // 3. Stream agent response
      const stream = createUIMessageStream<ChatMessage>({
        execute: async ({ writer: dataStream }) => {
          const agent = createMainAgent(dataStream);

          await sessionContext.run(
            { vmId: vm.hatchvmId, projectPath, sshConfig },
            async () => {
              const result = await agent.stream({ prompt });
              dataStream.merge(result.toUIMessageStream());
            }
          );
        },
      });

      return createUIMessageStreamResponse({ stream });
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
    "/chat/:chatId",
    // Unified endpoint - handles both new and existing chats
    zValidator(
      "json",
      z.object({
        userId: z.number(),
        message: z.object({
          id: z.string().uuid(),
          role: z.enum(["user"]),
          parts: z.array(partSchema),
        }),
        modelProvider: z.string(),
        model: z.string(),
        isNewChat: z.boolean().optional(), // Explicit flag for creating new chats
      })
    ),
    async (c) => {
      try {
        const chatId = c.req.param("chatId");
        const { userId, message, model, isNewChat } =
          c.req.valid("json");
        const messageId = message.id;

        log.info({ chatId, userId, isNewChat }, "Processing message");

        // Check if chat exists (also verifies ownership - see getChatInfo implementation)
        const chatInfoResult = await getChatInfo(userId, chatId);

        // Handle existing chat
        if (chatInfoResult.ok) {
          // Chat exists - prevent creation even if isNewChat is true
          if (isNewChat === true) {
            log.warn(
              { chatId, userId },
              "Attempted to create new chat with existing chatId"
            );
            return c.json(
              { error: "Chat already exists with this ID" },
              409 // Conflict
            );
          }

          log.info({ chatId, userId }, "Processing message in existing chat");

          const { messages: dbMessages, chat, project } = chatInfoResult.value;
          const messages = await convertModelMessage(dbMessages);
          const projectId = project?.uuid!;
          const contextResult = await resolveProjectChatContext(projectId);
          if (!contextResult.ok) {
            log.error(contextResult.error, "Failed to resolve project context");
            return c.json({ error: "Failed to prepare project context" }, 500);
          }

          // Create AI stream for existing chat
          const aiStream = await sessionContext.run(
            contextResult.value,
            async () => {
              const stream = createUIMessageStream<ChatMessage>({
                execute: async ({ writer: dataStream }) => {
                  // Create and merge AI stream with message history
                  const result = await createAIStream(
                    messages,
                    message,
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
        }

        // Chat doesn't exist - check if user explicitly wants to create new chat
        if (isNewChat !== true) {
          log.warn(
            { chatId, userId },
            "Chat not found and isNewChat flag not set"
          );
          return c.json(
            {
              error: "Chat not found. Set isNewChat=true to create a new chat.",
            },
            404
          );
        }

        // Handle new chat creation (explicit intent via isNewChat flag)
        log.info({ chatId, userId }, "Creating new chat and workspace");

        const projectId = uuidv4();

        // Create workspace, project, and chat with the provided chatId
        const projectContextResult = await createProjectChatContext(
          userId,
          projectId,
          chatId
        );

        if (!projectContextResult.ok) {
          log.error(
            { route: "/chat/:chatId", error: projectContextResult.error },
            "Failed to create project chat context"
          );
          return c.json({ error: projectContextResult.error }, 500);
        }

        const { chatDbId, context } = projectContextResult.value;

        // Set chatId in response header for frontend
        c.header("X-Chat-Id", chatId);

        // Create AI stream in the new workspace context
        const aiStream = await sessionContext.run(
          context,
          async () => {
            const stream = createUIMessageStream<ChatMessage>({
              execute: async ({ writer: dataStream }) => {
                // Create and merge AI stream
                const result = await createAIStream(
                  [], // No previous messages for new chat
                  message,
                  model,
                  dataStream
                );
                dataStream.merge(result.toUIMessageStream());
              },
              onFinish: async (event) => {
                if (event.messages && event.responseMessage) {
                  await saveMessages(
                    chatDbId,
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
        log.error(error, "Error processing message");
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  );

export { app, injectWebSocket };
