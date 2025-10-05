"use client";

import { useChat } from "@ai-sdk/react";
import { createTRPCChatTransport } from "@/lib/aiTransport";
import client from "../../../trpc/index";
import { useState } from "react";


  const { messages, status, stop, sendMessage } = useChat({
    id: "test-chat",
    transport: createTRPCChatTransport(client.ask.mutate)
  });

