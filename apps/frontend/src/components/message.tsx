"use client";

import { AnimatePresence, motion } from "framer-motion";
import { memo } from "react";
import type { ChatMessage } from "codeAgent/types/chat";
import { cn } from "@/lib/utils";
import { UseChatHelpers } from "@ai-sdk/react";

type MessagesProps = {
  status: UseChatHelpers<ChatMessage>["status"];
  messages: ChatMessage[];
};

function PureMessages({ status, messages }: MessagesProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-neutral-500">
            <div className="text-center">
              <h2 className="text-2xl font-bold">Welcome! 👋</h2>
              <p className="mt-2">Ask me to build something</p>
            </div>
          </div>
        )}

        {/* Render each message */}
        {messages.map((message) => (
          <PreviewMessage key={message.id} message={message} />
        ))}

        {/* Show "thinking" while waiting for first response */}
        <AnimatePresence mode="wait">
          {status === "submitted" && <ThinkingMessage key="thinking" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

export const Messages = memo(PureMessages);

const PurePreviewMessage = ({ message }: { message: ChatMessage }) => {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      className="w-full"
      data-role={message.role}
    >
      <div
        className={cn("flex w-full items-start gap-3", {
          "justify-end": message.role === "user",
          "justify-start": message.role === "assistant",
        })}
      >
        <div
          className={cn("flex flex-col gap-2", {
            "max-w-[80%]": message.role === "user",
            "w-full": message.role === "assistant",
          })}
        >
          {message.parts?.map((part, index) => {
            // Only render text parts in the chat
            if (part.type === "text") {
              return (
                <div
                  key={index}
                  className={cn(
                    "rounded-lg px-4 py-3 text-sm",
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  )}
                >
                  <div className="whitespace-pre-wrap">
                    {"text" in part ? part.text : ""}
                  </div>
                </div>
              );
            }

            // Tool calls - just show a badge, the actual code goes to IDE
            if (part.type.startsWith("tool-")) {
              return (
                <div
                  key={index}
                  className="rounded border bg-neutral-50 px-3 py-2 text-xs dark:bg-neutral-900"
                >
                  🔧 {part.type.replace("tool-", "")}
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </motion.div>
  );
};

export const PreviewMessage = memo(PurePreviewMessage);

// Shows while AI is thinking (before it starts streaming)
export const ThinkingMessage = () => {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      className="w-full"
    >
      <div className="flex items-start justify-start">
        <div className="rounded-lg bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">
          Thinking...
        </div>
      </div>
    </motion.div>
  );
};
