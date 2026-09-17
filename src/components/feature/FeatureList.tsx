import { FeatureItem } from "./FeatureItem";
import type { Feature } from "@/lib/blocks/data";

interface FeatureListProps {
  features: Feature[];
  /** When true, hides rename/delete kebabs and the inline "Add
   *  another flow" button — the row is read-only. Used for non-dev
   *  envs where features are authored under dev and other envs are
   *  views. */
  readOnly?: boolean;
  /** Active environment slug. When set, the per-row status counts
   *  inside each FeatureItem filter to flows with this envSlug. When
   *  undefined (the legacy env-less `/projects/:id` page), counts
   *  aggregate across every env. */
  envSlug?: string;
}

export function FeatureList({
  features,
  readOnly = false,
  envSlug,
}: FeatureListProps) {
  return (
    <ul className="space-y-2">
      {features.map((feature) => (
        <li key={feature.id}>
          <FeatureItem
            feature={feature}
            readOnly={readOnly}
            envSlug={envSlug}
          />
        </li>
      ))}
    </ul>
  );
}