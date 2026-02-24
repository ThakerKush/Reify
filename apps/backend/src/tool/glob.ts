import { tool } from "ai";
import { z } from "zod";
import { logger } from "../utils/log.js";
import { sessionContext } from "../session/sessionContext.js";
import * as ssh from "../services/ssh.js";

export const glob = tool({
  description:
    'File searching tool. Find files by patterns like "**/*.js" or "src/**/*.ts".',
  inputSchema: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .describe("The directory to search in (relative to project)")
      .optional(),
  }),
  execute: async ({ pattern, path }) => {
    logger.info(
      { child: "glob tool" },
      `Agent called glob tool with pattern ${pattern} and path ${path}`
    );

    const ctx = sessionContext.getContext();
    if (!ctx) {
      throw new Error("Session context not configured");
    }

    const searchPath = path || ".";
    const result = await ssh.exec(
      ctx.vmId,
      ctx.sshConfig,
      `rg --files --glob '${pattern}' ${searchPath}`,
      { cwd: ctx.projectPath }
    );

    if (!result.ok) {
      return "Error searching for files";
    }

    const files = result.value.stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    if (files.length === 0) {
      return "No files found";
    }

    const MAX_FILES = 100;
    const truncated = files.length > MAX_FILES;
    const displayFiles = truncated ? files.slice(0, MAX_FILES) : files;

    let output = displayFiles.join("\n");
    if (truncated) {
      output += `\n\nResults are truncated (showing ${MAX_FILES} of ${files.length} files), consider being more specific`;
    }

    return output;
  },
});
