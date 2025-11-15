import { tool, type Tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { handleStream } from "../utils/handleStream.js";
import { logger } from "../utils/log.js";
import type { ChatMessage } from "../app/types.js";

interface TerminalToolProps {
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

export const terminalTool = ({ dataStream }: TerminalToolProps) =>
  tool({
    description:
      "Use this tool to execute terminal commands only use this for interactive commands like cd, ls, etc do not use this command to start a server command line npm run dev are NOT allowed",
    inputSchema: z.object({
      command: z.string().describe("The command to execute"),
    }),
    execute: async ({ command }) => {
      try {
        logger.info(
          { child: "terminal tool" },
          `Agent called terminal tool with ${command} command `
        );

        // Write to stream when terminal input is received
        dataStream.write({
          type: "data-terminalDelta",
          data: `$ ${command}\n`,
          transient: true,
        });

        const context = sessionContext.getContext();
        if (!context) {
          throw new Error("No context found");
        }
        const marker = "__AGENT_COMMAND_DONE__";
        const stream = context.workspaceInfo.shellSession.stream;
        const commandWithMarker = `${command}; echo ${marker}$?`;
        // Write command to stream
        stream.write(commandWithMarker + "\n");

        // Handle the stream response
        const result = await handleStream(stream, {
          isTTY: false,
          collect: true,
          doneMarker: marker,
        });

        // Write to stream when terminal output is received
        if (result.stdout) {
          dataStream.write({
            type: "data-terminalDelta",
            data: result.stdout,
            transient: true,
          });
        }
        if (result.stderr) {
          dataStream.write({
            type: "data-terminalDelta",
            data: result.stderr,
            transient: true,
          });
        }

        logger.info(
          {
            child: "terminal tool",
            result: {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
            },
          },
          `Terminal tool executed. Result:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\nExit Code: ${result.exitCode}`
        );
        return `Command executed sucessfuly.
      STDOUT: 
      ${result.stdout}
      STDERR:
      ${result.stderr}
      Exit Code:
      ${result.exitCode}
      `;
      } catch (error) {
        logger.error(
          { child: "terminal tool" },
          `Terminal tool failed with ${error} error`
        );
        throw new Error("Unknown Error in terminal tool");
      }
    },
  });
