import { tool } from "ai";
import { z } from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";
import * as ssh from "../services/ssh.js";

export const grep = tool({
  description:
    "Search for a pattern in files using ripgrep. Results include file path, line number, and matching content.",
  inputSchema: z.object({
    pattern: z
      .string()
      .describe("The pattern to search for in files using regex"),
    path: z
      .string()
      .describe("The directory to search files in")
      .optional(),
    include: z
      .string()
      .describe('File pattern to include (e.g. "*.js", "*.{ts,js}")'),
    maxResults: z
      .number()
      .describe("Maximum number of results to return (default: 100)")
      .optional(),
  }),
  async execute({ pattern, path, include, maxResults = 100 }) {
    logger.info(
      { child: "grep tool" },
      `Agent called grep tool with pattern ${pattern}, path ${path}, include ${include}`
    );

    const ctx = sessionContext.getContext();
    if (!ctx) {
      throw new Error("Session context not configured");
    }

    const searchPath = path || ".";
    let command = `rg --color never --line-number --with-filename --max-count ${maxResults}`;
    if (include) {
      command += ` --glob '${include}'`;
    }
    command += ` '${pattern}' ${searchPath}`;

    const result = await ssh.exec(ctx.vmId, ctx.sshConfig, command, {
      cwd: ctx.projectPath,
    });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    if (!result.value.stdout && !result.value.stderr) {
      return { matches: [], message: "No matches found" };
    }

    if (result.value.stderr) {
      logger.warn(
        { child: "grep tool" },
        `Grep stderr: ${result.value.stderr}`
      );
    }

    const lines = result.value.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

    const matches = lines
      .map((line) => {
        const match = line.match(/^(.+?):(\d+):(.+)$/);
        if (match) {
          return {
            file: match[1],
            line: parseInt(match[2], 10),
            content: match[3],
          };
        }
        return null;
      })
      .filter(Boolean);

    return {
      matches,
      totalMatches: matches.length,
      message:
        matches.length > 0
          ? `Found ${matches.length} matches`
          : "No matches found",
    };
  },
});
