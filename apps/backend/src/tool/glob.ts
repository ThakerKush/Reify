import { tool } from "ai";
import z from "zod";
import { logger } from "../utils/log";
import { sessionContext } from "../session/sessionContext";
import * as dockerService from "../services/docker";

export const glob = tool({
    description: `File searching tool. Use this tool when you need to find files by patterns. Supports patterns like "**/*.js" or "src/**/*.ts".`,
    inputSchema: z.object({
        pattern: z.string().describe("The pattern to compare files against"),
        path: z.string().describe("The directory to search in, should be an abslute path").optional(),
    }), 
    execute: async ({pattern, path}) => {
        logger.info({child: "glob tool"}, `Agent called glob tool with pattern ${pattern} and path ${path}`)
        const workspace = sessionContext.getContext();
        if (!workspace) {
            throw new Error("Workspace Info not configured");
        }
        
        const searchPath = path || "/workspace";
        const result = await dockerService.executeCommand(
            workspace.workspaceInfo.containerId, 
            ["rg", "--files", "--glob", pattern, searchPath]
        );
        
        if (!result.ok) {
            return "Error searching for files";
        }
        
        const files = result.value.stdout.trim().split("\n").filter(f => f.length > 0);
        
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
    }

})