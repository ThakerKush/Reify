"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MentionChip } from "./mention-chip";
import { ChatControls } from "./chat-controls";
import { generateUUID } from "@/lib/utils";

interface ChatInputProps {
  onSubmit?: (message: string, mentions: string[], model: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({
  onSubmit,
  isStreaming = false,
  onStop,
}: ChatInputProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mode, setMode] = useState("code");
  const [model, setModel] = useState("gpt-4");
  const [isLoading, setIsLoading] = useState(false);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  const removeMention = (fileToRemove: string) => {
    setMentions((prev) => prev.filter((file) => file !== fileToRemove));
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || isStreaming) return;

    const userMessage = input;
    const userMentions = [...mentions];
    const userModel = model;

    // If onSubmit is provided, we're in an existing chat
    if (onSubmit) {
      setInput(""); // Clear input immediately
      await onSubmit(userMessage, userMentions, userModel);
      return;
    }

    // Otherwise, create a new chat
    setIsLoading(true);
    setInput(""); // Clear input immediately

    try {
      const messageId = generateUUID();

      // Call your /chat endpoint
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: 1, // TODO: Get from session/auth
            message: {
              id: messageId,
              role: "user",
              parts: [{ type: "text", text: userMessage }],
            },
            modelProvider: "openai",
            model: userModel,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create chat");
      }

      // Get chatId from response header
      const chatId = response.headers.get("X-Chat-Id");

      if (!chatId) {
        throw new Error("No chat ID in response");
      }

      // Store initial message in sessionStorage so chat page can use it
      sessionStorage.setItem(`chat-${chatId}-initial`, userMessage);

      // Redirect to chat page - the stream is already happening
      router.push(`/chat/${chatId}`);
    } catch (error) {
      console.error("Error starting chat:", error);
      setIsLoading(false);
      setInput(userMessage); // Restore input on error
    }
  };

  return (
    <div className="border border-border rounded-lg bg-card">
      {/* Top Bar */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {mentions.map((file) => (
            <MentionChip
              key={file}
              name={file}
              onRemove={() => removeMention(file)}
            />
          ))}
        </div>
      )}

      {/* Textarea Section */}
      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onInput={adjustHeight}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
          disabled={isLoading || isStreaming}
          className="w-full min-h-[70px] max-h-[200px] resize-none overflow-y-auto bg-transparent outline-none text-foreground placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>

      {/* Bottom Controls */}
      <ChatControls
        mode={mode}
        model={model}
        onModeChange={setMode}
        onModelChange={setModel}
        onSend={isStreaming ? onStop : handleSend}
        disabled={isLoading}
        isStreaming={isStreaming}
      />
    </div>
  );
}
