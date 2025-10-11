"use client";
import { ChatInput } from "@/components/app-chatInput";
export default function Home() {
  return (
    <div className="h-screen flex flex-col items-center">
      <div className="flex-1 w-full max-w-3xl px-4">Messaves</div>
      <div className="w-full max-w-3xl px-4 pb-4">
        <ChatInput />
      </div>
    </div>
  );
}