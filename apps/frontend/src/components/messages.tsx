import { ChatMessage } from "codeAgent/types/";
import { useDataStream } from "./data-stream-provider";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SparkleIcon } from "lucide-react";
const PurePreviewMessage = ({
  chatId,
  message,
  requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  requiresScrollPadding: boolean;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={message.role}
      data-testId={`message-${message.role}`}
      initial={{ opacity: 0 }}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparkleIcon size={14} />
          </div>
        )}
      </div>
    </motion.div>
  );
};
