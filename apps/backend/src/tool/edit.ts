import { tool, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { createTwoFilesPatch } from "diff";
import { logger } from "../utils/log.js";
import * as ssh from "../services/ssh.js";

export const edit: Tool = tool({
  description:
    "Edit a file by replacing an exact string match with new content. Provide enough surrounding context in oldContent to uniquely identify the location.",
  inputSchema: z.object({
    path: z.string().describe("Path of the file to edit"),
    oldContent: z
      .string()
      .describe(
        "The exact content to find and replace. Include enough surrounding lines to uniquely identify the location."
      ),
    newContent: z.string().describe("The replacement content"),
    replaceAll: z
      .boolean()
      .describe("Replace all occurrences of oldContent with newContent")
      .default(false),
  }),
  execute: async ({ path, oldContent, newContent, replaceAll }) => {
    try {
      logger.info({ child: "edit tool" }, `Agent is editing file ${path}`);

      const ctx = sessionContext.getContext();
      if (!ctx) {
        throw Error("Session context not configured");
      }

      const readResult = await ssh.exec(
        ctx.vmId,
        ctx.sshConfig,
        `cat '${path}'`,
        { cwd: ctx.projectPath }
      );

      if (!readResult.ok) {
        throw Error(`Failed to read file: ${readResult.error.message}`);
      }

      if (readResult.value.exitCode !== 0) {
        throw Error(
          readResult.value.stderr || `Failed to read file: ${path}`
        );
      }

      const fileContent = readResult.value.stdout;
      const replacedContent = smartReplace(
        fileContent,
        oldContent,
        newContent,
        replaceAll
      );

      const writeResult = await ssh.exec(
        ctx.vmId,
        ctx.sshConfig,
        `cat > '${path}' << 'RELAY_EOF'\n${replacedContent}\nRELAY_EOF`,
        { cwd: ctx.projectPath }
      );

      if (!writeResult.ok) {
        throw Error(`Failed to write file: ${writeResult.error.message}`);
      }

      const diff = createTwoFilesPatch(
        path,
        path,
        fileContent,
        replacedContent
      );

      return { message: "File edited successfully", diff };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { message: "File edit failed", error: errorMessage, path };
    }
  },
});

function smartReplace(
  fileContent: string,
  oldContent: string,
  newContent: string,
  replaceAll: boolean
): string {
  const fileLines = fileContent.split("\n");
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const exactMatches = findLineMatches(fileLines, oldLines, false);
  if (exactMatches.length > 0) {
    return applyReplacements(fileLines, exactMatches, newLines, replaceAll);
  }

  const normalizedMatches = findLineMatches(fileLines, oldLines, true);
  if (normalizedMatches.length > 0) {
    return applyReplacements(
      fileLines,
      normalizedMatches,
      newLines,
      replaceAll
    );
  }

  throw new Error(
    "Could not find a match for the provided oldContent in the file. Make sure you provide the exact text including whitespace."
  );
}

type LineMatch = { startLine: number; endLine: number };

function findLineMatches(
  fileLines: string[],
  oldLines: string[],
  normalize: boolean
): LineMatch[] {
  const matches: LineMatch[] = [];
  const norm = normalize
    ? (s: string) => s.replace(/\s+/g, " ").trim()
    : (s: string) => s;

  const normalizedOld = oldLines.map(norm);

  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    let isMatch = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (norm(fileLines[i + j]) !== normalizedOld[j]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      matches.push({ startLine: i, endLine: i + oldLines.length - 1 });
    }
  }

  return matches;
}

function applyReplacements(
  fileLines: string[],
  matches: LineMatch[],
  newLines: string[],
  replaceAll: boolean
): string {
  if (matches.length > 1 && !replaceAll) {
    throw new Error(
      `Found ${matches.length} matches but replaceAll is false. Set replaceAll to true to replace all occurrences.`
    );
  }

  const resultLines = [...fileLines];
  const toReplace = replaceAll ? matches : [matches[0]];

  for (const match of toReplace.sort((a, b) => b.startLine - a.startLine)) {
    resultLines.splice(
      match.startLine,
      match.endLine - match.startLine + 1,
      ...newLines
    );
  }

  return resultLines.join("\n");
}
