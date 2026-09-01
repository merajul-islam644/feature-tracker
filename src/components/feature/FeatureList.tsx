import { FeatureItem } from "./FeatureItem";

// Local shape — the canonical schema lives in
// src/types/Shemastructure/Feature.ts and is intentionally not imported.
interface Feature {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface FeatureListProps {
  features: Feature[];
}

export function FeatureList({ features }: FeatureListProps) {
  return (
    <ul className="space-y-2">
      {features.map((feature) => (
        <li key={feature.id}>
          <FeatureItem feature={feature} />
        </li>
      ))}
    </ul>
  );
}