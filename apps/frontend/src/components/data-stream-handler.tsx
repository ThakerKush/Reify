"use client";

import { useEffect, useRef } from "react";
import { useArtifact } from "@/hooks/use-artifact";
import { useDataStream } from "./data-stream-provider";

export function DataStreamHandler() {
  const { dataStream } = useDataStream(); // Get incoming stream
  const { artifact, setArtifact } = useArtifact(); // Get artifact state + updater
  const lastProcessedIndex = useRef(-1); // Track what we've already handled

  useEffect(() => {
    // No data yet? Nothing to do
    if (!dataStream?.length) {
      return;
    }

    // Get only the NEW deltas we haven't processed yet
    const newDeltas = dataStream.slice(lastProcessedIndex.current + 1);

    // Update the "last seen" index
    lastProcessedIndex.current = dataStream.length - 1;

    // Process each new delta
    for (const delta of newDeltas) {
      if (delta.type === "data-codeDelta") {
        const { path, content } = delta.data;

        setArtifact((draft) => {
          // Clone the files Map (never mutate directly!)
          const newFiles = new Map(draft.files);

          // Extract filename from path
          const pathParts = path.split("/");
          const name = pathParts[pathParts.length - 1];

          // Add or update this file
          newFiles.set(path, {
            path,
            name,
            content,
            isDirectory: false,
          });

          return {
            ...draft,
            files: newFiles,
            // Set first file as active if none selected yet
            activeFilePath: draft.activeFilePath || path,
            isVisible: true, // Show the IDE when first file arrives
            status: "streaming", // Mark as actively streaming
          };
        });
      }
      if (delta.type === "data-workspace") {
        setArtifact((draft) => ({
          ...draft,
          workspaceStatus: delta.data.status, // "loading" | "ready" | "error"
          workspaceMessage: delta.data.message, // "Workspace created"
        }));
      }
      if (delta.type === "data-textDelta") {
        setArtifact((draft) => ({
          ...draft,
          status: "idle", // No longer streaming
        }));
      }
    }
  }, [dataStream, setArtifact]);

  return null;
}
