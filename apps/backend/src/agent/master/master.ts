import { registery } from "@/src/app/registry"
import { Experimental_Agent as Agent } from "ai"
import { masterPrompt } from "./masterPrompt"

export const masterAgent = new Agent({
    model: registery.languageModel("openRouter:anthropic/claude-sonnet-4.5"), 
    system: masterPrompt,
    tools: {
        executor: 
    }
})
