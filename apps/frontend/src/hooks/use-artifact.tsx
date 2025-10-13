"use client";

import { UIArtifact } from "@/components/artifact";
import { useCallback, useMemo } from "react";
import useSWR from "swr";

export const initialArtifactData: UIArtifact = {
  kind: "ide",
  isVisible: false,
  status: "idle",
  files: new Map(), // Empty Map, no files yet
  activeFilePath: null, // No file selected
  workspaceStatus: "loading",
  workspaceMessage: "",
};


type Selector<T> = (state: UIArtifact) => T;

export function useArtifactSelector<Selected>(selector: Selector<Selected>) {
  const { data: localArtifact } = useSWR<UIArtifact>("artifact", null, {
    fallbackData: initialArtifactData,
  });

  const selectedValue = useMemo(() => {
    if (!localArtifact) {
      return selector(initialArtifactData);
    }
    return selector(localArtifact);
  }, [localArtifact, selector]);

  return selectedValue;
}

// Usage example:
// const isVisible = useArtifactSelector((state) => state.isVisible);

export function useArtifact() {
    const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
      "artifact",  // SWR cache key
      null,        // No fetcher (we manage state locally)
      {
        fallbackData: initialArtifactData,
      }
    );
  
    const artifact = useMemo(() => {
      if (!localArtifact) {
        return initialArtifactData;
      }
      return localArtifact;
    }, [localArtifact]);
  
    const setArtifact = useCallback(
      (updaterFn: UIArtifact | ((current: UIArtifact) => UIArtifact)) => {
        setLocalArtifact((current) => {
          const artifactToUpdate = current || initialArtifactData;
  
          if (typeof updaterFn === "function") {
            return updaterFn(artifactToUpdate);
          }
  
          return updaterFn;
        });
      },
      [setLocalArtifact]
    );
  
    return useMemo(
      () => ({
        artifact,
        setArtifact,
      }),
      [artifact, setArtifact]
    );
  }