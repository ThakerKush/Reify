import { tool, type Tool } from "ai";
import z from "zod";
import { sessionContext } from "../session/sessionContext.js";
import { createTwoFilesPatch } from "diff";
import { file } from "zod/v4";
import { logger } from "../utils/log.js";
import * as dockerService from "../services/docker.js";
export const edit: Tool = tool({
  description: "Edit a file",
  inputSchema: z.object({
    path: z.string().describe("Path of the file to edit"),
    oldContent: z.string().describe("Old content of the file to edit"),
    newContent: z.string().describe("New content of the file to edit"),
    replaceAll: z
      .boolean()
      .describe(
        "Replace all the occurences of the old_content with the new_content"
      ),
  }),
  execute: async ({ path, oldContent, newContent, replaceAll }) => {
    try {
      logger.info({ child: "edit tool" }, `Agent is editing file ${path}`);
      const workspace = sessionContext.getContext();
      if (!workspace) {
        throw Error("Workspace Info not configured");
      }
      const readResult = await dockerService.executeCommand(
        workspace.workspaceInfo.containerId,
        [`cat ${path}`]
      );

      if (!readResult.ok) {
        throw Error(`Failed to read file: ${readResult.error}`);
      }
      const fileContent = readResult.value.stdout;

      // Use the smartReplace function instead of duplicating logic
      const replacedContent = smartReplace(
        fileContent,
        oldContent,
        newContent,
        replaceAll
      );
      // Write the result back to the file
      const writeResult = await dockerService.executeCommand(
        workspace.workspaceInfo.containerId,
        ["sh", "-c", `cat > ${path} << 'EOF'\n${replacedContent}\nEOF`]
      );

      if (!writeResult.ok) {
        throw Error(`Failed to write file: ${writeResult.error.message}`);
      }

      // Generate a diff for verification
      const diff = createTwoFilesPatch(
        path,
        path,
        fileContent,
        replacedContent
      );

      return {
        message: "File edited successfully",
        diff: diff,
        replacedContent: replacedContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        message: "File edit failed",
        error: errorMessage,
        path: path,
      };
    }
  },
});

const smartReplace = (
  fileContent: string,
  oldContent: string,
  newContent: string,
  replaceAll: boolean
) => {
  // Handle escapedd characters
  const unescapeContent = (content: string): string => {
    return content
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\");
  };

  const processedOldContent = unescapeContent(oldContent);
  const processedNewContent = unescapeContent(newContent);

  // split files into lines
  const fileLines = fileContent.split("\n");
  const oldLines = processedOldContent.split("\n");
  const newLines = processedNewContent.split("\n");

  // First try exact matches
  // Strategy 1: Try exact line-by-line match first
  const exactMatches = findExactLineMatches(fileLines, oldLines);
  if (exactMatches.length > 0) {
    return handleLineMatches(fileLines, exactMatches, newLines, replaceAll);
  }

  // Strategy 2: Try normalized whitespace line match
  const normalizedMatches = findNormalizedLineMatches(fileLines, oldLines);
  if (normalizedMatches.length > 0) {
    return handleLineMatches(
      fileLines,
      normalizedMatches,
      newLines,
      replaceAll
    );
  }

  // Strategy 3: Try fuzzy line matching (first/last line + 80% content match)
  const fuzzyMatches = findFuzzyLineMatches(fileLines, oldLines);
  if (fuzzyMatches.length > 0) {
    return handleLineMatches(fileLines, fuzzyMatches, newLines, replaceAll);
  }

  throw new Error(
    `Could not find a suitable match for the provided oldContent in the file`
  );
};

function findExactLineMatches(fileLines: string[], oldLines: string[]) {
  const matches: Array<{
    startLine: number;
    endLine: number;
    matchedLines: string[];
  }> = [];
  // Look for consecutive sequences of lines that match oldLines exactly
  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    let isMatch = true;

    // Check if consecutive lines match exactly
    for (let j = 0; j < oldLines.length; j++) {
      if (fileLines[i + j] !== oldLines[j]) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      matches.push({
        startLine: i,
        endLine: i + oldLines.length - 1,
        matchedLines: fileLines.slice(i, i + oldLines.length),
      });
    }
  }

  return matches;
}

/**
 * Normalize whitespace for line comparison
 */
function normalizeWhitespace(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/**
 * Find matches after normalizing whitespace on each line
 */
function findNormalizedLineMatches(
  fileLines: string[],
  oldLines: string[]
): Array<{ startLine: number; endLine: number; matchedLines: string[] }> {
  const matches: Array<{
    startLine: number;
    endLine: number;
    matchedLines: string[];
  }> = [];

  // Normalize old lines for comparison
  const normalizedOldLines = oldLines.map(normalizeWhitespace);

  // Look for consecutive sequences with normalized whitespace matching
  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    let isMatch = true;

    // Check if consecutive normalized lines match
    for (let j = 0; j < oldLines.length; j++) {
      if (normalizeWhitespace(fileLines[i + j]) !== normalizedOldLines[j]) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      matches.push({
        startLine: i,
        endLine: i + oldLines.length - 1,
        matchedLines: fileLines.slice(i, i + oldLines.length),
      });
    }
  }

  return matches;
}

/**
 * Calculate similarity between two lines
 */
function calculateLineSimilarity(line1: string, line2: string): number {
  const normalized1 = normalizeWhitespace(line1);
  const normalized2 = normalizeWhitespace(line2);

  const maxLen = Math.max(normalized1.length, normalized2.length);
  if (maxLen === 0) return 1.0;

  let matches = 0;
  const minLen = Math.min(normalized1.length, normalized2.length);

  for (let i = 0; i < minLen; i++) {
    if (normalized1[i] === normalized2[i]) {
      matches++;
    }
  }

  return matches / maxLen;
}

/**
 * Calculate overall similarity for a sequence of lines
 */
function calculateSequenceSimilarity(
  fileLines: string[],
  oldLines: string[],
  startIndex: number
): number {
  if (oldLines.length === 0) return 1.0;

  let totalSimilarity = 0;
  const endIndex = Math.min(startIndex + oldLines.length, fileLines.length);

  for (let i = 0; i < oldLines.length; i++) {
    const fileLineIndex = startIndex + i;
    if (fileLineIndex < fileLines.length) {
      totalSimilarity += calculateLineSimilarity(
        fileLines[fileLineIndex],
        oldLines[i]
      );
    }
  }

  return totalSimilarity / oldLines.length;
}

/**
 * Find fuzzy line matches using first/last line + 80% content similarity
 */
function findFuzzyLineMatches(
  fileLines: string[],
  oldLines: string[]
): Array<{ startLine: number; endLine: number; matchedLines: string[] }> {
  const matches: Array<{
    startLine: number;
    endLine: number;
    matchedLines: string[];
  }> = [];

  if (oldLines.length < 2) {
    return matches; // Need at least 2 lines for fuzzy matching
  }

  const firstLine = normalizeWhitespace(oldLines[0]);
  const lastLine = normalizeWhitespace(oldLines[oldLines.length - 1]);

  // Find potential starting positions by matching the first line
  for (let i = 0; i < fileLines.length; i++) {
    if (normalizeWhitespace(fileLines[i]) === firstLine) {
      // Look for the last line within a reasonable range
      for (
        let j = i + oldLines.length - 1;
        j < Math.min(fileLines.length, i + oldLines.length + 5);
        j++
      ) {
        if (normalizeWhitespace(fileLines[j]) === lastLine) {
          // Check if the overall sequence has at least 80% similarity
          const similarity = calculateSequenceSimilarity(
            fileLines,
            oldLines,
            i
          );

          if (similarity >= 0.8) {
            matches.push({
              startLine: i,
              endLine: j,
              matchedLines: fileLines.slice(i, j + 1),
            });
          }
        }
      }
    }
  }

  return matches;
}

/**
 * Handle the actual line-based replacement
 */
function handleLineMatches(
  fileLines: string[],
  matches: Array<{
    startLine: number;
    endLine: number;
    matchedLines: string[];
  }>,
  newLines: string[],
  replaceAll: boolean
): string {
  if (matches.length === 0) {
    throw new Error("No matches found");
  }

  if (matches.length > 1 && !replaceAll) {
    throw new Error(
      `Found ${matches.length} matches but replaceAll is false. Enable replaceAll to replace all occurrences.`
    );
  }

  // Sort matches by start line in descending order to replace from end to beginning
  // This prevents line number shifting issues
  const sortedMatches = matches.sort((a, b) => b.startLine - a.startLine);

  // Create a copy of file lines to modify
  let resultLines = [...fileLines];

  for (const match of sortedMatches) {
    // Replace the matched lines with new lines
    resultLines.splice(
      match.startLine,
      match.endLine - match.startLine + 1,
      ...newLines
    );
  }

  return resultLines.join("\n");
}

function testSmartReplace(
  fileContent: string,
  oldContent: string,
  newContent: string,
  replaceAll: boolean = false
): string {
  // Handle escaped characters
  const unescapeContent = (content: string): string => {
    return content
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\");
  };

  const processedOldContent = unescapeContent(oldContent);
  const processedNewContent = unescapeContent(newContent);

  // Split files into lines
  const fileLines = fileContent.split("\n");
  const oldLines = processedOldContent.split("\n");
  const newLines = processedNewContent.split("\n");

  // Strategy 1: Try exact line-by-line match first
  const exactMatches = findExactLineMatches(fileLines, oldLines);
  if (exactMatches.length === 1 || (exactMatches.length > 1 && replaceAll)) {
    console.log(`Found exact match(es): ${exactMatches.length}`);
    return handleLineMatches(fileLines, exactMatches, newLines, replaceAll);
  }

  // Strategy 2: Try normalized whitespace line match
  const normalizedMatches = findNormalizedLineMatches(fileLines, oldLines);
  if (
    normalizedMatches.length === 1 ||
    (normalizedMatches.length > 1 && replaceAll)
  ) {
    console.log(`Found normalized match(es): ${normalizedMatches.length}`);
    return handleLineMatches(
      fileLines,
      normalizedMatches,
      newLines,
      replaceAll
    );
  }

  // Strategy 3: Try fuzzy line matching (first/last line + 80% content match)
  const fuzzyMatches = findFuzzyLineMatches(fileLines, oldLines);
  if (fuzzyMatches.length === 1 || (fuzzyMatches.length > 1 && replaceAll)) {
    console.log(`Found fuzzy match(es): ${fuzzyMatches.length}`);
    return handleLineMatches(fileLines, fuzzyMatches, newLines, replaceAll);
  }

  // Error reporting
  console.log(`Exact matches: ${exactMatches.length}`);
  console.log(`Normalized matches: ${normalizedMatches.length}`);
  console.log(`Fuzzy matches: ${fuzzyMatches.length}`);

  if (
    exactMatches.length > 1 ||
    normalizedMatches.length > 1 ||
    fuzzyMatches.length > 1
  ) {
    throw new Error(
      `Found multiple matches but replaceAll is false. Enable replaceAll to replace all occurrences.`
    );
  } else {
    throw new Error(
      `Could not find a suitable match for the provided oldContent in the file`
    );
  }
}
