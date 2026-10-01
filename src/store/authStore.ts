// The previous zustand-backed mock auth store has been replaced by the
// Blocks-backed session in `src/components/blocks/AuthProvider.tsx`. This
// file is kept as a no-op shim so any stale imports compile while the rest
// of the codebase migrates — the real auth state now lives in IAM as a
// Secure, httpOnly cookie managed by the Blocks SDK, not in this process.
//
// New code should import from `@/hooks/useAuth` or `useAuthContext` from
// `@/components/blocks/AuthProvider` instead.
export {};
