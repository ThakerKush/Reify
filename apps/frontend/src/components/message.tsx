import { useMessages } from "@/hooks/use-messages";
import { ChatMessage } from "codeAgent/types/";
import { UseChatHelpers } from "@ai-sdk/react";
import { useDataStream } from "./data-stream-provider";
import { useEffect } from "react";
import { Conversation, ConversationContent } from "./conversation";
import { Greeting } from "./greeting";

type MessageProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  messages: ChatMessage[];
  isArtifactVisible: boolean;
};

function PureMessage({
  chatId,
  status,
  messages,
  isArtifactVisible,
}: MessageProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    chatId,
    status,
  });

  useDataStream();

  useEffect(() => {
    if (status === "submitted") {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
        }
      });
    }
  }, [status, messagesContainerRef]);

  return (
    <div
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
      ref={messagesContainerRef}
      style={{ overflowAnchor: "none" }}
    >
      <Conversation className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && <Greeting />}

           {messages.map((messages, index) => {
            <PreviewMess
           })}
        </ConversationContent>
      </Conversation>
      
    </div>
  );
}
