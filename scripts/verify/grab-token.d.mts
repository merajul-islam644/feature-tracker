// Type shim for grab-token.mjs (plain ESM JS, no .d.ts of its own).
// Keep the signature narrow — only what's actually consumed.
export function getBearerToken(): Promise<string>;