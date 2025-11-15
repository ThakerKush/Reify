"use client";

import { AnimatePresence, motion } from "framer-motion";
import { XIcon, FolderIcon } from "lucide-react";
import Editor from "@monaco-editor/react";
import { useArtifact } from "@/hooks/use-artifact";
import { cn } from "@/lib/utils";
import { FileIcon } from "./file-icon";

export type FileNode = {
  path: string; // e.g., "src/App.tsx"
  name: string; // e.g., "App.tsx"
  content: string; // The actual code
  isDirectory: boolean;
};

// Your IDE artifact state
export type UIArtifact = {
  kind: "ide"; // Only one artifact type for you
  isVisible: boolean; // Whether the IDE overlay is open
  status: "idle" | "streaming"; // Is code currently streaming in?
  files: Map<string, FileNode>; // All files by path
  activeFilePath: string | null; // Which file is open in Monaco
  workspaceStatus: "loading" | "ready" | "error"; // Docker workspace status
  workspaceMessage: string; // Status message from backend
};

export function Artifact() {
  const { artifact, setArtifact } = useArtifact();

  // Don't render if not visible
  if (!artifact.isVisible) {
    return null;
  }

  const fileList = Array.from(artifact.files.values());
  const activeFile = artifact.activeFilePath
    ? artifact.files.get(artifact.activeFilePath)
    : null;

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: "100%" }}
        initial={{ opacity: 0, x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed top-0 right-0 z-50 flex h-dvh w-[70vw] flex-col border-l bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-neutral-50 p-3 dark:bg-neutral-900">
          <div className="flex flex-col">
            <h2 className="font-semibold text-sm">Code Editor</h2>
            <p className="text-muted-foreground text-xs">
              {artifact.workspaceStatus === "ready"
                ? "✓ Workspace ready"
                : artifact.workspaceStatus === "loading"
                  ? "⏳ Setting up workspace..."
                  : artifact.workspaceMessage || "IDE"}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setArtifact((draft) => ({ ...draft, isVisible: false }))
            }
            className="rounded p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            aria-label="Close IDE"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        {/* Main IDE area: Sidebar + Monaco */}
        <div className="flex flex-1 overflow-hidden">
          {/* File Sidebar */}
          <div className="w-64 border-r bg-neutral-50 dark:bg-neutral-900">
            <div className="border-b p-2 px-3">
              <h3 className="font-medium text-xs uppercase text-neutral-600 dark:text-neutral-400">
                Files
              </h3>
            </div>
            <div className="overflow-y-auto">
              {fileList.length === 0 ? (
                <div className="p-4 text-center text-neutral-500 text-xs">
                  No files yet
                </div>
              ) : (
                fileList.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() =>
                      setArtifact((draft) => ({
                        ...draft,
                        activeFilePath: file.path,
                      }))
                    }
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800",
                      artifact.activeFilePath === file.path &&
                        "bg-neutral-200 dark:bg-neutral-700"
                    )}
                  >
                    {file.isDirectory ? (
                      <FolderIcon className="size-4 shrink-0 text-blue-500" />
                    ) : (
                      <FileIcon
                        filename={file.name}
                        className="size-4 shrink-0"
                      />
                    )}
                    <span className="truncate">{file.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1">
            {activeFile ? (
              <Editor
                height="100%"
                language={detectLanguage(activeFile.name)}
                value={activeFile.content}
                theme="vs-dark"
                options={{
                  readOnly: true, // Make editable later
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-neutral-500 text-sm">
                {fileList.length === 0
                  ? "Waiting for code..."
                  : "Select a file to view"}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Detect language from file extension
function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    html: "html",
    css: "css",
    scss: "scss",
    py: "python",
    rs: "rust",
    go: "go",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
  };
  return languageMap[ext || ""] || "plaintext";
}
