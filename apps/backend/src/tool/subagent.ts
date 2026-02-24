import { tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
import { logger } from "../utils/log.js";
import { runSubagent } from "../agent/subagent/subagent.js";
import type { ChatMessage } from "../app/types.js";

interface SubagentToolProps {
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

export const createSubagent = ({ dataStream }: SubagentToolProps) =>
  tool({
    description:
      "Spawn a subagent to perform a task. Use this to delegate work that requires reading many files, searching, debugging, or exploration. Describe the task clearly and provide relevant context.",
    inputSchema: z.object({
      task: z
        .string()
        .describe("Clear description of what the subagent should accomplish"),
      context: z
        .string()
        .describe(
          "Relevant context: file paths, error messages, constraints, etc."
        ),
      model: z
        .enum(["fast", "medium", "strong"])
        .describe(
          "Model tier. fast = cheap/quick tasks, medium = most tasks, strong = complex reasoning"
        )
        .default("medium"),
    }),
    execute: async ({ task, context, model }) => {
      try {
        return await runSubagent(task, context, model, dataStream);
      } catch (error) {
        logger.error({ child: "subagent tool" }, `Subagent failed: ${error}`);
        return `Subagent failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
