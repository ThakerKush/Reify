import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { stepCountIs, streamText, type UserModelMessage } from "ai";
import { Err, Ok, type Result } from "../errors/result.js";
import type { SessionContext } from "../session/sessionContext.js";
import { DbError } from "../services/db.js";
import * as dbService from "../services/db.js";
import * as vmService from "../services/vm.js";
import * as sshService from "../services/ssh.js";
import config from "../config/index.js";
import { registery } from "./registry.js";
import { terminalTool } from "../tool/terminal.js";
import { createWrite } from "../tool/write.js";
import { read } from "../tool/read.js";
import { edit } from "../tool/edit.js";
import { describe } from "../tool/describte.js";
import { serve as fin } from "../tool/serve.js";

export const createProjectChatContext = async (
  userId: number,
  projectId: string,
  chatId: string
): Promise<Result<{ chatDbId: number; context: SessionContext }, DbError>> => {
  const projectResult = await dbService.insertProject(projectId, userId);
  if (!projectResult.ok) return Err(projectResult.error);

  const keyResult = vmService.generateSSHKeyPair();
  if (!keyResult.ok) {
    return Err(DbError.queryFailed("generateSSHKeyPair", keyResult.error));
  }

  const vmResult = await vmService.createVM(keyResult.value.publicKeyOpenSSH);
  if (!vmResult.ok) return Err(DbError.queryFailed("createVM", vmResult.error));

  const vmInsertResult = await dbService.insertVm({
    userId,
    projectId: projectResult.value,
    hatchvmId: vmResult.value.id,
    host: config.hatchvm.sshHost,
    sshPort: vmResult.value.ssh_port,
    sshPrivateKey: keyResult.value.privateKeyOpenSSH,
    sshPublicKey: keyResult.value.publicKeyOpenSSH,
  });
  if (!vmInsertResult.ok) return Err(vmInsertResult.error);

  const projectPath = `/home/relay/projects/${projectId}`;
  const sshConfig = {
    host: vmInsertResult.value.host || config.hatchvm.sshHost,
    port: vmInsertResult.value.sshPort || 22,
    username: "relay",
    privateKey: vmInsertResult.value.sshPrivateKey,
  };

  const mkdirResult = await sshService.exec(
    vmInsertResult.value.hatchvmId,
    sshConfig,
    `mkdir -p ${projectPath}`
  );
  if (!mkdirResult.ok) {
    return Err(DbError.queryFailed("createProjectDir", mkdirResult.error));
  }

  const chatResult = await dbService.insertChat({
    userId,
    projectId: projectResult.value,
    title: null,
    visibility: "private",
    uuid: chatId,
    createdAt: new Date(),
  });
  if (!chatResult.ok) return Err(chatResult.error);

  return Ok({
    chatDbId: chatResult.value,
    context: {
      vmId: vmInsertResult.value.hatchvmId,
      projectPath,
      sshConfig,
      projectId,
    },
  });
};

export const resolveProjectChatContext = async (
  projectId: string
): Promise<Result<SessionContext, DbError>> => {
  const projectResult = await dbService.getProject(projectId);
  if (!projectResult.ok) return Err(projectResult.error);

  const vmResult = await dbService.getVmByProjectId(projectResult.value.id);
  if (!vmResult.ok) return Err(vmResult.error);

  const vm = vmResult.value;
  const projectPath = `/home/relay/projects/${projectId}`;
  const sshConfig = {
    host: vm.host || config.hatchvm.sshHost,
    port: vm.sshPort || 22,
    username: "relay",
    privateKey: vm.sshPrivateKey,
  };

  const mkdirResult = await sshService.exec(
    vm.hatchvmId,
    sshConfig,
    `mkdir -p ${projectPath}`
  );
  if (!mkdirResult.ok) {
    return Err(DbError.queryFailed("ensureProjectDir", mkdirResult.error));
  }

  return Ok({
    vmId: vm.hatchvmId,
    projectPath,
    sshConfig,
    projectId,
  });
};

export const createAIStream = async (
  messages: any[],
  userMessage: any,
  model: string,
  dataStream: any
) => {
  const registryModelId: `openRouter:${string}` = `openRouter:${model}`;
  return streamText({
    model: registery.languageModel(registryModelId),
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
    stopWhen: stepCountIs(100),
  });
};

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
  if (!userResult.ok) return Err(userResult.error);

  const aiResult = await dbService.insertMessage(chatId, resultMsg);
  if (!aiResult.ok) return Err(aiResult.error);

  return Ok(undefined);
};
