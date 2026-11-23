// Shared project resolution for the two workbench-hosting pages
// (/tests and /panel): reads the active env's project from the Blocks
// gateway and maps it onto the workbench's `Project` shape. The
// workbench only keys on `id` (store + persistence scoping) and
// `name` (watermark, terminal titles); the rest are display defaults
// TestPilot's demo data always carried.

import { useActiveEnv } from "@/contexts/ActiveEnvContext";
import { useProject } from "@/lib/blocks/hooks";
import type { Project as WorkbenchProject } from "@/lib/demo/data";

export type WorkbenchProjectResolution =
  | { state: "no-env" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; project: WorkbenchProject };

export function useWorkbenchProject(): WorkbenchProjectResolution {
  const activeEnv = useActiveEnv();
  const { data: project, isLoading, isError } = useProject(activeEnv?.projectId);

  if (!activeEnv) return { state: "no-env" };
  if (isLoading) return { state: "loading" };
  if (isError || !project) return { state: "error" };

  return {
    state: "ready",
    project: {
      id: project.id,
      name: project.name,
      description: project.description ?? "",
      icon: "globe",
      tags: [],
      createdAt: Date.parse(project.createdAt) || Date.now(),
    },
  };
}
