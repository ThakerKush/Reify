import { ToolLoopAgent, stepCountIs, type UIMessageStreamWriter } from "ai";
import { registery } from "../../app/registry.js";
import { mainPrompt } from "./mainPrompt.js";
import { read } from "../../tool/read.js";
import { edit } from "../../tool/edit.js";
import { grep } from "../../tool/grep.js";
import { glob } from "../../tool/glob.js";
import { terminalTool } from "../../tool/terminal.js";
import { createWrite } from "../../tool/write.js";
import { serve } from "../../tool/serve.js";
import { describe } from "../../tool/describte.js";
import { todoRead, todoWrite } from "../../tool/todo.js";
import { webSearch, webExtract } from "../../tool/webSearch.js";
import { createSubagent } from "../../tool/subagent.js";
import type { ChatMessage } from "../../app/types.js";

export const createMainAgent = (
  dataStream: UIMessageStreamWriter<ChatMessage>
) =>
  new ToolLoopAgent({
    id: "relay-main",
    model: registery.languageModel("openRouter:anthropic/claude-sonnet-4.6"),
    instructions: mainPrompt,
    tools: {
      read,
      write: createWrite({ dataStream }),
      edit,
      grep,
      glob,
      terminal: terminalTool({ dataStream }),
      serve,
      describe,
      todoRead,
      todoWrite,
      webSearch,
      webExtract,
      subagent: createSubagent({ dataStream }),
    },
    stopWhen: stepCountIs(100),
  });
