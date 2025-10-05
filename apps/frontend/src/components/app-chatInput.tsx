import { useEffect, useRef, useState } from "react";
import { MentionChip } from "./mention-chip";
import { ChatControls } from "./chat-controls";

export function ChatInput() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentions, setMentions] = useState<string[]>(["file.tsx", "test.py"]);
  const [mode, setMode] = useState("code");
  const [model, setModel] = useState("gpt-4");

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    adjustHeight();
  }, []);

  const removeMention = (fileToRemove: string) => {
    setMentions((prev) => prev.filter((file) => file !== fileToRemove));
  };

  const handleSend = () => {
    // TODO: Implement send logic
    console.log("Sending message with mode:", mode, "and model:", model);
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
          placeholder="Type a message..."
          onInput={adjustHeight}
          className="w-full min-h-[70px] max-h-[200px] resize-none overflow-y-auto bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Bottom Controls */}
      <ChatControls
        mode={mode}
        model={model}
        onModeChange={setMode}
        onModelChange={setModel}
        onSend={handleSend}
      />
    </div>
  );
}