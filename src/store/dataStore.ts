import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { seedFeatures, seedFlows, seedProjects } from "@/lib/seed";
import { generateId } from "@/lib/id";

// Local shape definitions — see src/types/Shemastructure/ for the
// canonical schemas, which are intentionally not imported here.
interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface Feature {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface Flow {
  id: string;
  projectId: string;
  featureId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface DataState {
  projects: Project[];
  features: Feature[];
  flows: Flow[];
  isHydrated: boolean;

  // Selectors
  getProject: (id: string) => Project | undefined;
  getProjectFeatures: (projectId: string) => Feature[];
  getFeatureFlows: (featureId: string) => Flow[];
  getProjectFlows: (projectId: string) => Flow[];

  // Mutations
  addProject: (name: string, userId: string, featureNames: string[]) => Project;
  addFeature: (projectId: string, name: string) => Feature | null;
  addFlow: (projectId: string, featureId: string, name: string) => Flow | null;
  touchProject: (projectId: string) => void;

  setHydrated: () => void;
}

export const useDataStore = create<DataState>()(
  persist(
    (set, get) => ({
      projects: seedProjects,
      features: seedFeatures,
      flows: seedFlows,
      isHydrated: false,

      getProject: (id) => get().projects.find((p) => p.id === id),

      getProjectFeatures: (projectId) =>
        get().features.filter((f) => f.projectId === projectId),

      getFeatureFlows: (featureId) =>
        get().flows.filter((f) => f.featureId === featureId),

      getProjectFlows: (projectId) =>
        get().flows.filter((f) => f.projectId === projectId),

      addProject: (name, userId, featureNames) => {
        const now = new Date().toISOString();
        const project: Project = {
          id: generateId("proj"),
          userId,
          name: name.trim(),
          createdAt: now,
          updatedAt: now,
        };

        const validFeatureNames = featureNames
          .map((n) => n.trim())
          .filter((n) => n.length > 0);

        // Deduplicate feature names within the same project
        const seen = new Set<string>();
        const uniqueFeatureNames = validFeatureNames.filter((n) => {
          const key = n.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const newFeatures: Feature[] = uniqueFeatureNames.map((fname) => ({
          id: generateId("feat"),
          projectId: project.id,
          name: fname,
          createdAt: now,
          updatedAt: now,
        }));

        set((state) => ({
          projects: [project, ...state.projects],
          features: [...newFeatures, ...state.features],
        }));

        return project;
      },

      addFeature: (projectId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;

        const now = new Date().toISOString();
        const feature: Feature = {
          id: generateId("feat"),
          projectId,
          name: trimmed,
          createdAt: now,
          updatedAt: now,
        };

        // Guard against duplicate feature names within the same project
        const exists = get().features.some(
          (f) =>
            f.projectId === projectId &&
            f.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (exists) return null;

        set((state) => ({
          features: [feature, ...state.features],
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, updatedAt: now } : p
          ),
        }));
        return feature;
      },

      addFlow: (projectId, featureId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;

        // Validate feature belongs to project
        const feature = get().features.find((f) => f.id === featureId);
        if (!feature || feature.projectId !== projectId) return null;

        const now = new Date().toISOString();
        const flow: Flow = {
          id: generateId("flow"),
          projectId,
          featureId,
          name: trimmed,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          flows: [flow, ...state.flows],
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, updatedAt: now } : p
          ),
        }));
        return flow;
      },

      touchProject: (projectId) => {
        const now = new Date().toISOString();
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, updatedAt: now } : p
          ),
        }));
      },

      setHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: "ft-data",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        projects: state.projects,
        features: state.features,
        flows: state.flows,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);