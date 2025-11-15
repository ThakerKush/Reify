import { Chat } from "@/components/chat";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Chat
      chatId={id}
      userId={1} // TODO: Get from session
      modelProvider="openai"
      model="gpt-4"
    />
  );
}