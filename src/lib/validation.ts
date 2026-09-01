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

// Helper for validating a single feature name within a list (for Create Project form)
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