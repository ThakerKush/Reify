import { tool, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";

const todoSchema = z.object({
  description: z.string().describe("Brief description of the current task"),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("The status of the current task"),
  priority: z
    .enum(["low", "medium", "high"])
    .describe("The priority of the current task"),
});

export const todoWrite: Tool = tool({
  description: "Write to the todo list to track tasks.",
  inputSchema: z.object({
    todo: z
      .array(todoSchema)
      .describe("The todo list items to write"),
  }),
  execute: async ({ todo }) => {
    logger.info(
      { child: "todo write tool" },
      `Agent is writing todo list with ${todo.length} items`
    );
    const context = sessionContext.getContext();
    if (!context) {
      throw new Error("Session context not configured");
    }
    context.todo = todo;
    return { message: `Todo list updated with ${todo.length} items` };
  },
});

export const todoRead: Tool = tool({
  description: "Read the current todo list.",
  inputSchema: z.object({}),
  execute: async () => {
    logger.info({ child: "todo read tool" }, `Agent is reading todo list`);
    const context = sessionContext.getContext();
    if (!context) {
      throw new Error("Session context not configured");
    }
    const todo = context.todo;
    if (!todo) {
      return { message: "No todo list found" };
    }
    return { message: JSON.stringify(todo) };
  },
});
