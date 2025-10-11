import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { streamText, type UserModelMessage } from "ai";
import { Err, Ok, type Result } from "../errors/result.js";
import { DbError } from "../services/db.js";
import { DockerError } from "../errors/dockerError.js";
import { WorkspaceManagerError } from "../services/workspaceManager.js";
import type { SessionContext } from "../session/sessionContext.js";
import type { WorkspaceInfo } from "../services/docker.js";
import * as dbService from "../services/db.js";
import * as dockerService from "../services/docker.js";
import * as workspaceManager from "../services/workspaceManager.js";
import {
  getSessionContext,
  setSessionContext,
} from "../services/workspaceManager.js";
import { registery } from "./registry.js";
import { terminalTool } from "../tool/terminal.js";
import { createWrite } from "../tool/write.js";
import { read } from "../tool/read.js";
import { edit } from "../tool/edit.js";
import { describe } from "../tool/describte.js";
import { fin } from "../tool/serve.js";
import { logger } from "../utils/log.js";

const log = logger.child({ service: "business-logic" });

/**
 * Creates a new workspace container and project
 */
export const createNewWorkspace = async (
  userId: number,
  projectId: string,
  chatId: string,
  imageName: string
): Promise<
  Result<
    { project: number; chat: number; workspace: WorkspaceInfo },
    DbError | DockerError
  >
> => {
  // Create container
  const containerResult = await dockerService.createBaseWorkspace(
    projectId,
    imageName
  );
  if (!containerResult.ok) {
    return Err(containerResult.error);
  }

  // Create project in database
  const projectResult = await dbService.insertProject(
    projectId,
    userId,
    "active"
  );
  if (!projectResult.ok) {
    return Err(projectResult.error);
  }

  // Create chat in database
  const chatResult = await dbService.insertChat({
    userId,
    projectId: projectResult.value,
    title: null,
    visibility: "private",
    uuid: chatId,
    createdAt: new Date(),
  });
  if (!chatResult.ok) {
    return Err(chatResult.error);
  }

  // Set up session context
  const context: SessionContext = {
    projectId,
    workspaceInfo: containerResult.value,
  };
  setSessionContext(projectId, context);

  return Ok({
    project: projectResult.value,
    chat: chatResult.value,
    workspace: containerResult.value,
  });
};

/**
 * Fetches or restores a workspace, ensuring it's ready
 */
export const ensureWorkspaceReady = async (
  projectId: string,
  dataStream: any
): Promise<
  Result<SessionContext, DbError | DockerError | WorkspaceManagerError>
> => {
  // Check if workspace is already in memory
  const existingContext = getSessionContext(projectId);
  if (existingContext) {
    dataStream.write({
      type: "data-workspace",
      data: {
        status: "ready",
        message: "Workspace active",
      },
      transient: true,
    });
    return Ok(existingContext);
  }

  // Try to find workspace in Docker
  dataStream.write({
    type: "data-workspace",
    data: {
      status: "loading",
      message: "Checking workspace status",
    },
    transient: true,
  });

  let workspaceResult = await dockerService.getWorkspace(projectId);

  // If not in Docker, restore from S3
  if (!workspaceResult.ok) {
    dataStream.write({
      type: "data-workspace",
      data: {
        status: "loading",
        message: "Restoring workspace",
      },
      transient: true,
    });

    const restoreResult = await workspaceManager.restoreWorkspace(projectId);
    if (!restoreResult.ok) {
      return Err(restoreResult.error);
    }

    workspaceResult = await dockerService.getWorkspace(projectId);
    if (!workspaceResult.ok) {
      return Err(workspaceResult.error);
    }
  }

  // Create and store context
  const context: SessionContext = {
    projectId,
    workspaceInfo: workspaceResult.value,
  };
  setSessionContext(projectId, context);

  dataStream.write({
    type: "data-workspace",
    data: {
      status: "ready",
      message: "Workspace ready",
    },
    transient: true,
  });

  return Ok(context);
};

/**
 * Creates an AI stream for chat processing
 * Note: Session context is accessed via sessionContext.run(), not passed as parameter
 */
export const createAIStream = async (
  messages: any[],
  userMessage: any,
  modelProvider: string,
  model: string,
  dataStream: any
) => {
  return streamText({
    model: registery.languageModel(`${modelProvider}:${model}`),
    system: readFileSync(
      new URL("../prompts/system.txt", import.meta.url),
      "utf-8"
    ),
    messages: [
      ...messages,
      {
        role: "user",
        content: userMessage.parts,
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
};

/**
 * Saves messages to the database
 */
export const saveMessages = async (
  chatId: number,
  userMessage: any,
  messageId: string,
  responseMessage: any
): Promise<Result<void, DbError>> => {
  const userMsg = {
    chatId,
    role: userMessage.role,
    parts: userMessage.parts,
    attachments: [],
    messageUuid: messageId,
    createdAt: new Date(),
  };

  const resultMsg = {
    chatId,
    messageUuid: uuidv4(),
    role: responseMessage.role,
    parts: responseMessage.parts,
    attachments: [],
    createdAt: new Date(),
  };

  const userResult = await dbService.insertMessage(chatId, userMsg);
  if (!userResult.ok) {
    return Err(userResult.error);
  }

  const aiResult = await dbService.insertMessage(chatId, resultMsg);
  if (!aiResult.ok) {
    return Err(aiResult.error);
  }

  return Ok(undefined);
};

/**
 * Handles file reading in containers
 */
export const readFileFromContainer = async (
  containerId: string,
  path: string
): Promise<Result<string, DockerError>> => {
  const result = await dockerService.executeCommand(containerId, ["cat", path]);
  if (!result.ok) {
    return Err(result.error);
  }
  return Ok(result.value.stdout);
};

/**
 * Handles file writing in containers
 */
export const writeFileToContainer = async (
  containerId: string,
  path: string,
  content: string
): Promise<Result<void, DockerError>> => {
  const result = await dockerService.executeCommand(containerId, [
    "echo",
    content,
    ">",
    path,
  ]);
  if (!result.ok) {
    return Err(result.error);
  }
  return Ok(undefined);
};

/**
 * Handles WebSocket file change events
 */
export const handleFileChangeEvent = async (
  event: string,
  filePath: string,
  containerId: string,
  ws: any
): Promise<void> => {
  if ((event === "change" || event === "add") && filePath) {
    const relativePath = filePath.replace("/workspace/", "");

    const contentResult = await readFileFromContainer(
      containerId,
      relativePath
    );
    if (contentResult.ok) {
      ws.send(
        JSON.stringify({
          type: "file_changed",
          path: relativePath,
          content: contentResult.value,
        })
      );
    } else {
      log.error(contentResult.error, `Error reading file: ${relativePath}`);
    }
  }
};

/**
 * Handles WebSocket messages
 */
export const handleWebSocketMessage = async (
  msg: any,
  containerId: string,
  ws: any
): Promise<void> => {
  switch (msg.type) {
    case "terminal_input":
      // Terminal input handling would go here
      break;

    case "list_files":
      const filesResult = await dockerService.listFiles(containerId);
      if (filesResult.ok) {
        ws.send(
          JSON.stringify({ type: "initial_files", files: filesResult.value })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to list files",
          })
        );
      }
      break;

    case "read_file":
      const fileResult = await readFileFromContainer(containerId, msg.path);
      if (fileResult.ok) {
        ws.send(
          JSON.stringify({
            type: "file_content",
            path: msg.path,
            content: fileResult.value,
          })
        );
      } else {
        log.error(fileResult.error, `Failed to read file: ${msg.path}`);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to read file",
          })
        );
      }
      break;

    case "write_file":
      const writeResult = await writeFileToContainer(
        containerId,
        msg.path,
        msg.content
      );
      if (writeResult.ok) {
        ws.send(
          JSON.stringify({
            type: "file_written",
            path: msg.path,
            content: msg.content,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to write file",
          })
        );
      }
      break;
  }
};
