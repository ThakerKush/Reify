import { tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext";
import { logger } from "../utils/log";
import * as dockerService from "../services/docker";

export const grep = tool({
    description: "You have access to ripgrep via this tool, use it to search for a pattern in a file or directory, the results will be returned in a list of objects with the following properties: file, line, and content",
    inputSchema: z.object({
        pattern: z.string().describe("The pattern to search for in files using regex"),
        path: z.string().describe("The Directory to search files in").optional(),
        include: z.string().describe(`The file pattern to include in search (e.g. "*.js", "*.{ts,js}"`),
        maxResults: z.number().describe("Maximum number of results to return (default: 100)").optional(),

    }),
    async execute({ pattern, path, include, maxResults = 100 }){
        logger.info({child: "grep tool"}, `Agent called grep tool with pattern ${pattern}, path ${path}, and include ${include}`)
        const workspace = sessionContext.getContext();
        if (!workspace) { 
            throw new Error("Workspace Info not configured");
        }
        const command = ["rg", "--color", "never", "--line-number", "--with-filename", "max-count", maxResults.toString()];
        if (include) {
            command.push("--glob", include);
        }
        command.push(path ? `/workspace/${path}` : "/workspace");

        logger.info({ child: "grep tool" }, `Executing command: ${command.join(" ")}`);

        const result = await dockerService.executeCommand(workspace.workspaceInfo.containerId, command)
        if(!result.ok){
            logger.error({ child: "grep tool" }, `Error executing command: ${command.join(" ")}`, result.error);
            throw new Error(result.error.message);
        }
        
        if (!result.value.stdout && !result.value.stderr) {
            logger.warn({ child: "grep tool" }, `No stdout or stderr returned from command`);
            return {
                matches: [],
                message: "No matches found",
            };
        }

        if (result.value.stderr) {
            logger.warn({ child: "grep tool" }, `Grep stderr: ${result.value.stderr}`);
        }

        // Parse the output
        const lines = result.value.stdout.trim().split("\n").filter(line => line.length > 0);
        const matches = lines.map(line => {
            // Format: /workspace/path/to/file.ts:123:matching line content
            const match = line.match(/^(.+?):(\d+):(.+)$/);
            if (match) {
                return {
                    file: match[1].replace("/workspace/", ""),
                    line: parseInt(match[2], 10),
                    content: match[3],
                };
            }
            return null;
        }).filter(Boolean);

        return {
            matches,
            totalMatches: matches.length,
            message: matches.length > 0 ? `Found ${matches.length} matches` : "No matches found",
        };
    },
});