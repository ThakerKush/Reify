import { tool, UIMessageStreamWriter, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";
import * as ssh from "../services/ssh.js";
import type { ChatMessage } from "../app/types.js";

interface WriteToolProps {
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

export const createWrite = ({ dataStream }: WriteToolProps) =>
  tool({
    description: "Write to a file",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Absolute path of the file to write to. Make sure parent directories exist before writing."
        ),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ path, content }) => {
      logger.info({ child: "write tool" }, `Agent is writing to file ${path}`);
      const ctx = sessionContext.getContext();
      if (!ctx) {
        throw Error("Session context not configured");
      }

      const result = await ssh.exec(
        ctx.vmId,
        ctx.sshConfig,
        `mkdir -p "$(dirname '${path}')" && cat > '${path}' << 'RELAY_EOF'\n${content}\nRELAY_EOF`,
        { cwd: ctx.projectPath }
      );

      if (!result.ok) {
        logger.error(
          { child: "write tool" },
          `Error writing to file ${path}`,
          result.error
        );
        return `Error writing file: ${result.error.message}`;
      }

      if (result.value.stderr && result.value.stderr.trim()) {
        logger.error(
          { child: "write tool", stderr: result.value.stderr },
          `Error writing to file ${path}`
        );
        return `Error writing file to ${path}: ${result.value.stderr}`;
      }

      dataStream.write({
        type: "data-codeDelta",
        data: {
          path: path,
          content: content,
        },
      });

      logger.info({ child: "write tool" }, `File ${path} written successfully`);
      return `File written successfully to ${path}`;
    },
  });
