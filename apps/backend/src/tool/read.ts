import { tool, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";
import * as dockerService from "../services/docker.js";

export const read: Tool = tool({
  description: "Read a file",
  inputSchema: z.object({
    path: z.string().describe("Path of the file to read"),
  }),
  execute: async ({ path }) => {
    logger.info({ child: "read tool" }, `Agent is reading file ${path}`);
    const workspace = sessionContext.getContext();
    if (!workspace) {
      throw Error("Workspace Info not configured");
    }
    const result = await dockerService.executeCommand(
      workspace.workspaceInfo.containerId,
      ["cat", path]
    );
    if (result.ok) {
      return formatfileContent(path, result.value.stdout);
    } else {
      logger.error(
        { child: "read tool" },
        `Error reading file ${path}`,
        result.error
      );
      throw Error(result.error.message);
    }
  },
});

function formatfileContent(filenName: string, content: string) {
  const lines = content.split("\n");

  const formatedLines = lines.map((line, index) => {
    const lineNumber = (index + 1).toString().padStart(4, "0");
    return `${lineNumber} | ${line}`;
  });
  return `<${filenName}>\n${formatedLines.join("\n")}\n</${filenName}>`;
}
