"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { ArrowUp } from "lucide-react";

interface ChatControlsProps {
  mode: string;
  model: string;
  onModeChange: (mode: string) => void;
  onModelChange: (model: string) => void;
  onSend: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function ChatControls({
  mode,
  model,
  onModeChange,
  onModelChange,
  onSend,
  disabled = false,
  isStreaming = false,
}: ChatControlsProps) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 border-t border-border/50">
      <div className="flex items-center gap-2">
        {/* Mode Selector */}
        <Select value={mode} onValueChange={onModeChange} disabled={disabled}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="code">Code</SelectItem>
            <SelectItem value="chat">Chat</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
          </SelectContent>
        </Select>

        {/* Model Selector */}
        <Select value={model} onValueChange={onModelChange} disabled={disabled}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-4">GPT-4</SelectItem>
            <SelectItem value="gpt-3.5">GPT-3.5</SelectItem>
            <SelectItem value="claude-3">Claude 3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Round Send Button */}
      <button
        onClick={onSend}
        disabled={disabled}
        className="flex items-center justify-center w-8 h-8 shrink-0 aspect-square bg-primary text-primary-foreground rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isStreaming ? "Stop" : <ArrowUp className="w-4 h-4" />}
      </button>
    </div>
  );
}
