// Cloud-shape → UI-shape adapters for the three schemas we ship. The cloud
// record uses platform-managed field names (`ItemId`, `CreatedDate`, etc.)
// plus whatever custom fields we defined (see `blocks/data/schemas/*.json`).
// UI code consumes the local shapes here so renaming a cloud field never
// ripples into every page.

import { blocksClient } from "./client";

// --- Raw cloud record shapes (only the fields we read or set) --------------

export interface CloudProject {
  ItemId: string;
  name: string;
  description?: string;
  status: string;
  color?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface CloudFeature {
  ItemId: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  projectId: string;
  tags?: string[];
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface CloudFlow {
  ItemId: string;
  title: string;
  description?: string;
  steps?: string[];
  status: string;
  featureId: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// --- UI-facing shapes (unchanged from the old mock store) -------------------

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Feature {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Flow {
  id: string;
  projectId: string;
  featureId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// --- Adapters ---------------------------------------------------------------

export function toProject(p: CloudProject): Project {
  return {
    id: p.ItemId,
    name: p.name,
    createdAt: p.CreatedDate,
    updatedAt: p.LastUpdatedDate,
  };
}

export function toFeature(f: CloudFeature, projectId: string): Feature {
  return {
    id: f.ItemId,
    projectId: projectId || f.projectId,
    name: f.title,
    createdAt: f.CreatedDate,
    updatedAt: f.LastUpdatedDate,
  };
}

export function toFlow(fl: CloudFlow, projectId: string): Flow {
  const fallbackProjectId =
    (fl as unknown as { projectId?: string }).projectId ?? "";
  return {
    id: fl.ItemId,
    projectId: projectId || fallbackProjectId,
    featureId: fl.featureId,
    name: fl.title,
    createdAt: fl.CreatedDate,
    updatedAt: fl.LastUpdatedDate,
  };
}

// --- Pagination envelope ----------------------------------------------------

interface PagedCloud<T> {
  items?: T[];
  totalCount?: number;
}

function unwrapPaged<T>(raw: unknown): { items: T[]; totalCount: number } {
  const r = raw as
    | { data?: PagedCloud<T> }
    | PagedCloud<T>
    | undefined;
  const paged = (r && "data" in r ? r.data : r) as PagedCloud<T> | undefined;
  return {
    items: paged?.items ?? [],
    totalCount: paged?.totalCount ?? 0,
  };
}

// --- Collection accessors ---------------------------------------------------

export const projectsCollection = blocksClient.data.collection<CloudProject>("Project");
export const featuresCollection = blocksClient.data.collection<CloudFeature>("Feature");
export const flowsCollection = blocksClient.data.collection<CloudFlow>("Flow");

// --- Helpers ----------------------------------------------------------------

// Build the "current user's projects" filter. The platform stamps
// `CreatedBy` on insert from the OIDC `sub` claim, so filtering on it scopes
// list/get/delete to the signed-in caller.
export function createdByFilter(userId: string) {
  return { CreatedBy: { eq: userId } };
}