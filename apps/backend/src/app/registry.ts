import { createProviderRegistry } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import config from "../config/index.js";
const apiey = config.ai.open_router_api_key;
export const registery = createProviderRegistry({
  openRouter: createOpenRouter({ apiKey: apiey }),
});
