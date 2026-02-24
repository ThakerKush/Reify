import {
  generateText,
  stepCountIs,
  type UIMessageStreamWriter,
} from "ai";
import { registery } from "../../app/registry.js";
import { logger } from "../../utils/log.js";
import { subagentPrompt } from "./subagentPrompt.js";
import { read } from "../../tool/read.js";
import { edit } from "../../tool/edit.js";
import { grep } from "../../tool/grep.js";
import { glob } from "../../tool/glob.js";
import { createWrite } from "../../tool/write.js";
import { terminalTool } from "../../tool/terminal.js";
import { todoRead, todoWrite } from "../../tool/todo.js";
import { webSearch, webExtract } from "../../tool/webSearch.js";
import type { ChatMessage } from "../../app/types.js";

const modelMap = {
  fast: "openRouter:anthropic/claude-haiku-3.5",
  medium: "openRouter:anthropic/claude-sonnet-4",
  strong: "openRouter:anthropic/claude-sonnet-4.6",
} as const;

export type SubagentModel = keyof typeof modelMap;

export const runSubagent = async (
  task: string,
  context: string,
  model: SubagentModel = "medium",
  dataStream?: UIMessageStreamWriter<ChatMessage>
): Promise<string> => {
  logger.info(
    { child: "subagent", model },
    `Spawning subagent: ${task.slice(0, 100)}`
  );

  const modelId = modelMap[model] as `openRouter:${string}`;

  const tools: Record<string, any> = {
    read,
    edit,
    grep,
    glob,
    todoRead,
    todoWrite,
    webSearch,
    webExtract,
  };

  if (dataStream) {
    tools.write = createWrite({ dataStream });
    tools.terminal = terminalTool({ dataStream });
  }

  const result = await generateText({
    model: registery.languageModel(modelId),
    system: subagentPrompt,
    prompt: `Context:\n${context}\n\nTask:\n${task}`,
    tools,
    stopWhen: stepCountIs(50),
  });

  logger.info(
    { child: "subagent", steps: result.steps.length },
    `Subagent completed in ${result.steps.length} steps`
  );

  return result.text || "Subagent completed but returned no summary.";
};
