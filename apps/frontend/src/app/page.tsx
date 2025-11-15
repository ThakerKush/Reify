import { ChatInput } from "@/components/app-chatInput";

export default function HomePage() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold">Welcome 👋</h1>
          <p className="mt-2 text-muted-foreground">
            What would you like to build today?
          </p>
        </div>
        <ChatInput />
      </div>
    </div>
  );
}