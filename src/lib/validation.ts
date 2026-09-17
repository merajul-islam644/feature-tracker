import { z } from "zod";

export const nameSchema = z
  .string()
  .trim()
  .min(1, "This field is required")
  .max(100, "Must be 100 characters or fewer");

export const projectNameSchema = nameSchema;

export const featureNameSchema = nameSchema;

export const flowNameSchema = nameSchema;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email");

export const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .min(6, "Password must be at least 6 characters");

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;

// Helper for validating a single feature name against the names of OTHER
// features (for Create Project form). IMPORTANT: `existingNames` must
// exclude the row being validated — passing the full list including the
// row's own name produces a self-match against `lower`, which fires
// "Duplicate feature name" on every non-empty input. Callers should pass
// every other row's value (filtered by id, index, or whatever the call
// site uses to identify its rows). Empty / whitespace inputs are
// silently allowed here — the form leaves blank rows untouched and only
// the non-empty rows are submitted.
export function validateFeatureName(
  name: string,
  existingNames: string[]
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null; // empty inputs are silently skipped
  if (trimmed.length > 100) return "Must be 100 characters or fewer";
  const lower = trimmed.toLowerCase();
  if (existingNames.some((n) => n.trim().toLowerCase() === lower)) {
    return "Duplicate feature name";
  }
  return null;
}

// The four canonical envs are auto-included on every project card and
// cannot be redefined through the Add Environment modal.
export const CANONICAL_ENV_SLUGS = ["dev", "stg", "prod", "uat"] as const;
export type CanonicalEnvSlug = (typeof CANONICAL_ENV_SLUGS)[number];

// Env slug: URL-safe identifier for `/projects/:id/:envSlug`. Used in chip
// clicks and page badges, so it must be lowercase, dash-and-letter-only,
// and at most 32 chars. Reserved-slug and uniqueness checks live in the
// modal where the full project env list is available.
export const envSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(32, "Slug must be 32 characters or fewer")
  .regex(
    /^[a-z0-9][a-z0-9-]{0,31}$/,
    "Use lowercase letters, digits, and dashes (max 32 chars)",
  );

// Helper for validating an env slug against a project's current env list.
// Returns the first error message, or `null` if the slug is acceptable.
export function validateEnvSlug(
  slug: string,
  existingSlugs: readonly string[],
): string | null {
  const trimmed = slug.trim();
  const formatCheck = envSlugSchema.safeParse(trimmed);
  if (!formatCheck.success) {
    return formatCheck.error.issues[0]?.message ?? "Invalid slug";
  }
  const lower = trimmed.toLowerCase();
  if ((CANONICAL_ENV_SLUGS as readonly string[]).includes(lower)) {
    return `${lower} is reserved. Choose a different slug.`;
  }
  if (existingSlugs.some((s) => s.toLowerCase() === lower)) {
    return "This env already exists in this project.";
  }
  return null;
}