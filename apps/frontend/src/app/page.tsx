"use client";
import { ChatInput } from "@/components/app-chatInput";
export default function Home() {
  return (
    <div className ="h-screen flex flex-col items-center">
        <div className="flex-1">
            Messaves
        </div>
        <div className="p-4 w-full">
            <ChatInput />
        </div>
    </div>
  );
}