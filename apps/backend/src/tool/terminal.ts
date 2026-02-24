import { tool, type Tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { logger } from "../utils/log.js";
import * as ssh from "../services/ssh.js";
import type { ChatMessage } from "../app/types.js";
import type { ClientChannel } from "ssh2";

interface TerminalToolProps {
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

const MARKER = "__RELAY_CMD_DONE__";

const ensureShell = async (
  vmId: string,
  sshConfig: ssh.SSHConnectionConfig,
  projectPath: string
): Promise<ClientChannel> => {
  const ctx = sessionContext.getContext();
  if (ctx?.shellChannel) {
    return ctx.shellChannel;
  }

  const shellResult = await ssh.shell(vmId, sshConfig, { cwd: projectPath });
  if (!shellResult.ok) {
    throw new Error(`SSH shell failed: ${shellResult.error.message}`);
  }

  if (ctx) {
    ctx.shellChannel = shellResult.value;
  }

  return shellResult.value;
};

const collectUntilMarker = (
  shell: ClientChannel
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const onData = (data: Buffer) => {
      stdout += data.toString();
      const markerIndex = stdout.indexOf(MARKER);
      if (markerIndex !== -1) {
        const afterMarker = stdout.slice(markerIndex + MARKER.length);
        const match = afterMarker.match(/^(\d+)/);
        if (match) {
          const exitCode = parseInt(match[1], 10);
          stdout = stdout.slice(0, markerIndex);
          shell.removeListener("data", onData);
          shell.stderr.removeListener("data", onStderr);
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
        }
      }
    };

    const onStderr = (data: Buffer) => {
      stderr += data.toString();
    };

    shell.on("data", onData);
    shell.stderr.on("data", onStderr);
  });
};

export const terminalTool = ({ dataStream }: TerminalToolProps) =>
  tool({
    description:
      "Execute terminal commands. Use for running programs, installing packages, git operations, etc. Do not use for long-running server processes.",
    inputSchema: z.object({
      command: z.string().describe("The command to execute"),
    }),
    execute: async ({ command }) => {
      try {
        logger.info(
          { child: "terminal tool" },
          `Agent called terminal tool with: ${command}`
        );

        dataStream.write({
          type: "data-terminalDelta",
          data: `$ ${command}\n`,
          transient: true,
        });

        const ctx = sessionContext.getContext();
        if (!ctx) {
          throw new Error("Session context not configured");
        }
        const shell = await ensureShell(
          ctx.vmId,
          ctx.sshConfig,
          ctx.projectPath
        );

        shell.write(`${command}; echo ${MARKER}$?\n`);

        const result = await collectUntilMarker(shell);

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
          { child: "terminal tool", exitCode: result.exitCode },
          `Terminal tool executed. Exit code: ${result.exitCode}`
        );

        return `Command executed.
STDOUT:
${result.stdout}
STDERR:
${result.stderr}
Exit Code: ${result.exitCode}`;
      } catch (error) {
        logger.error(
          { child: "terminal tool" },
          `Terminal tool failed: ${error}`
        );
        throw new Error("Terminal command failed");
      }
    },
  });
