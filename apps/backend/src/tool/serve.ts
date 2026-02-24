import { tool, type Tool } from "ai";
import z from "zod";
import { logger } from "../utils/log.js";
import { sessionContext } from "../session/sessionContext.js";

export const fin: Tool = tool({
  description:
    "Use this tool to specify the run and build command for the project",
  inputSchema: z.object({
    run: z.string().describe("The command to run the project"),
    build: z.string().describe("The command to build the project"),
  }),
  execute: async ({ run, build }) => {
    logger.info({ child: "serve tool" }, `Agent is serving the project`);
    const context = sessionContext.getContext();
    if (!context) {
      throw new Error("Session context not configured");
    }
    context.runCommand = run;
    context.buildCommand = build;
    logger.info(
      { child: "serve tool" },
      `Project served with run command ${run} and build command ${build}`
    );
    return `Project served with run command ${run} and build command ${build}`;
  },
});
