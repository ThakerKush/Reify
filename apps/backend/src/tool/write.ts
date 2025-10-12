import { tool, UIMessageStreamWriter, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";
import * as dockerService from "../services/docker.js";
import { ChatMessage } from "../app/types.js";

interface WriteToolProps {
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

export const createWrite = ({ dataStream }: WriteToolProps) =>
  tool({
    description: "Write to a file",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Absloute path of the file to write to, must be absolte"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ path, content }) => {
      logger.info({ child: "write tool" }, `Agent is writing to file ${path}`);
      const workspace = sessionContext.getContext();
      if (!workspace) {
        throw Error("Workspace Info not configured");
      }
      const result = await dockerService.executeCommand(
        workspace.workspaceInfo.containerId,
        ["bash", "-c", `cat > ${path} << 'EOF'\n${content}\nEOF`]
      );

      if (!result.ok) {
        logger.error(
          { child: "write tool" },
          `Error writing to file ${path}`,
          result.error
        );
        return `Error writing file: ${result.error.message}`;
      }

      // Check if there's an error in stderr
      if (result.value.stderr && result.value.stderr.trim()) {
        logger.error(
          { child: "write tool", stderr: result.value.stderr },
          `Error writing to file ${path}`
        );
        return `Error writing file to ${path}: ${result.value.stderr}`;
      }

      // Success - write to stream and return success message
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
