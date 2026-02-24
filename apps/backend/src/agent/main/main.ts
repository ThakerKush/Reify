import { ToolLoopAgent } from "ai";
import { registery } from "../../app/registry.js";

export const mainAgent = new ToolLoopAgent({
    model: registery.languageModel("openRouter:anthropic/claude-sonnet-4.6"),
    tools: {

    }, 
});