import { tool, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";
import * as ssh from "../services/ssh.js";

export const read: Tool = tool({
  description: "Read a file",
  inputSchema: z.object({
    path: z.string().describe("Path of the file to read"),
  }),
  execute: async ({ path }) => {
    logger.info({ child: "read tool" }, `Agent is reading file ${path}`);
    const ctx = sessionContext.getContext();
    if (!ctx) {
      throw Error("Session context not configured");
    }

    const result = await ssh.exec(ctx.vmId, ctx.sshConfig, `cat ${path}`, {
      cwd: ctx.projectPath,
    });

    if (!result.ok) {
      logger.error({ child: "read tool" }, `Error reading file ${path}`);
      throw Error(result.error.message);
    }

    if (result.value.exitCode !== 0) {
      throw Error(result.value.stderr || `Failed to read file: ${path}`);
    }

    return formatFileContent(path, result.value.stdout);
  },
});

function formatFileContent(fileName: string, content: string) {
  const lines = content.split("\n");
  const formattedLines = lines.map((line, index) => {
    const lineNumber = (index + 1).toString().padStart(4, "0");
    return `${lineNumber} | ${line}`;
  });
  return `<${fileName}>\n${formattedLines.join("\n")}\n</${fileName}>`;
}
