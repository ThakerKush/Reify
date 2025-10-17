"use client";

import { useChat } from "@ai-sdk/react";
import { DataUIPart, DefaultChatTransport } from "ai";
import { useRef, useMemo, useState, useCallback } from "react";
import { generateUUID } from "@/lib/utils";
import type { ChatMessage, CustomUIDataTypes } from "codeAgent/types/chat";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./message";
import { Artifact } from "./artifact";
import { DataStreamHandler } from "./data-stream-handler";
import { ChatInput } from "./app-chatInput";

export function Chat({
  chatId,
  userId,
  modelProvider,
  model,
}: {
  chatId: string;
  userId: number;
  modelProvider: string;
  model: string;
}) {
  const { setDataStream } = useDataStream();

  const userIdRef = useRef(userId);
  const modelProviderRef = useRef(modelProvider);
  const modelRef = useRef(model);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/chat/${chatId}`,
        prepareSendMessagesRequest(request) {
          return {
            body: {
              userId: userIdRef.current,
              message: request.messages.at(-1),
              modelProvider: modelProviderRef.current,
              model: modelRef.current,
            },
          };
        },
      }),
    [chatId]
  );

  const { messages, sendMessage, status, stop } = useChat<ChatMessage>({
    id: chatId,
    messages: [],
    experimental_throttle: 100,
    generateId: generateUUID,
    transport,
    onData: (dataPart) => {
      setDataStream((prev) => [
        ...(prev || []),
        dataPart as DataUIPart<CustomUIDataTypes>,
      ]);
    },
  });

  const handleSubmit = useCallback(
    async (message: string, mentions: string[], modelName: string) => {
      if (!message.trim() || status === "streaming") return;

      await sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: message }],
      });
    },
    [sendMessage, status]
  );

  return (
    <>
      <DataStreamHandler />

      <div className="flex h-dvh flex-col bg-background">
        <Messages status={status} messages={messages} />

        {/* Input at bottom */}
        <div className="sticky bottom-0 border-t bg-background px-4 pb-4 pt-3">
          <div className="mx-auto max-w-4xl">
            <ChatInput
              onSubmit={handleSubmit}
              isStreaming={status === "streaming"}
              onStop={stop}
            />
          </div>
        </div>
      </div>

      <Artifact />
    </>
  );
}
