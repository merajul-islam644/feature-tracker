// Mock Zustand data store removed. Reads and writes now go through
// TanStack Query hooks backed by the Blocks data collections — see
// `src/lib/hooks.ts` (`useProjects`, `useCreateProject`, etc.). This file
// is kept only so any stale import resolves to `undefined` rather than a
// missing-module error during the migration; remove once all consumers are
// updated.
//
// Intentionally empty.
export {};