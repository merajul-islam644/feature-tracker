import { FeatureItem } from "./FeatureItem";
import type { Feature } from "@/lib/blocks/data";

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