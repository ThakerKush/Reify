// convert the messages in db to model message type

import * as schema from "@repo/db/schema";
import {
  convertToModelMessages,
  type AssistantModelMessage,
  type FilePart,
  type ImagePart,
  type ModelMessage,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
  type UIMessage,
  type UserModelMessage,
} from "ai";

export async function convertModelMessage(
  message: schema.Message[]
): Promise<ModelMessage[]> {
  const uiMessages = message.map((message) => {
    const uiMessage: UIMessage = {
      id: message.messageUuid,
      role: message.role as "user" | "system" | "assistant",
      parts: message.parts as any,
    };
    return uiMessage;
  });
  return await convertToModelMessages(uiMessages);
}
