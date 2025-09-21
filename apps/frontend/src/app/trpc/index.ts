import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { Approuter } from "codeAgent/types/AppRouter";

const client = createTRPCClient<Approuter>({
  links: [
    httpBatchLink({
      url: "http://localhost:3001/trpc",
    }),
  ],
});

export default client;
