import { tool, type Tool } from "ai";
import z from "zod";
import { logger } from "../utils/log.js";
import { sessionContext } from "../session/sessionContext.js";
import * as ssh from "../services/ssh.js";
import config from "../config/index.js";

export const serve: Tool = tool({
  description:
    "Build and run a project, then expose it to the internet via a public URL. The server process runs in the background.",
  inputSchema: z.object({
    port: z
      .number()
      .describe("The port the application will listen on (e.g. 3000, 8080)"),
    run: z.string().describe("The command to start the server (e.g. 'npm run dev', 'python app.py')"),
    build: z.string().describe("The command to build the project (e.g. 'npm run build')").optional(),
  }),
  execute: async ({ port, run, build }) => {
    logger.info({ child: "serve tool" }, `Agent is serving on port ${port}`);

    const ctx = sessionContext.getContext();
    if (!ctx) {
      throw new Error("Session context not configured");
    }

    ctx.runCommand = run;
    ctx.buildCommand = build;

    const errors: string[] = [];

    if (build) {
      logger.info({ child: "serve tool" }, `Running build: ${build}`);
      const buildResult = await ssh.exec(ctx.vmId, ctx.sshConfig, build, {
        cwd: ctx.projectPath,
      });

      if (!buildResult.ok) {
        return `Build failed: ${buildResult.error.message}`;
      }

      if (buildResult.value.exitCode !== 0) {
        return `Build failed (exit ${buildResult.value.exitCode}):\n${buildResult.value.stderr || buildResult.value.stdout}`;
      }
    }

    logger.info({ child: "serve tool" }, `Starting server: ${run}`);
    const startResult = await ssh.exec(
      ctx.vmId,
      ctx.sshConfig,
      `nohup ${run} > /tmp/relay-server.log 2>&1 & echo $!`,
      { cwd: ctx.projectPath }
    );

    if (!startResult.ok) {
      return `Failed to start server: ${startResult.error.message}`;
    }

    const pid = startResult.value.stdout.trim();
    logger.info({ child: "serve tool", pid }, `Server started with PID ${pid}`);

    const subdomain = ctx.vmId;

    try {
      const response = await fetch(
        `${config.hatchvm.apiUrl}/vms/${ctx.vmId}/routes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain, target_port: port }),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        logger.error(
          { child: "serve tool", status: response.status, body },
          "Failed to create route"
        );
        return `Server started (PID ${pid}) but failed to expose port: ${body}`;
      }

      const url = `https://${subdomain}.${config.hatchvm.host}`;

      logger.info({ child: "serve tool", url }, `Port ${port} exposed at ${url}`);

      return `Server started (PID ${pid}) and exposed at ${url}`;
    } catch (error) {
      logger.error({ child: "serve tool" }, `Failed to expose port: ${error}`);
      return `Server started (PID ${pid}) but failed to create route: ${error}`;
    }
  },
});
