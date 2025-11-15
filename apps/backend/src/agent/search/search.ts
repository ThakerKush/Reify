import { registery } from "@/src/app/registry";
import { Experimental_Agent as Agent, stepCountIs } from "ai";
import { searchPrompt } from "./searchPrompt";
import { grep } from "@/src/tool/grep";
import { glob } from "@/src/tool/glob";
import { webExtract, webSearch } from "@/src/tool/webSearch";

export const searchAgent = new Agent({
    model: registery.languageModel("openRouter:anthropic/claude-haiku-4.5"),
    system: searchPrompt,
    tools: {
        grep,
        glob,
        webSearch,
        webExtract
    },
    stopWhen: stepCountIs(100)
})