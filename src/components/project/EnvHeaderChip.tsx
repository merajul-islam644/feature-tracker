// EnvHeaderChip — the env Badge for a project-env page header, plus
// (opt-in) manager-only pencil (rename) and trash (delete) icons.
// Rendered on EVERY env surface: the env landing
// (`/projects/:id/:envSlug`), FeaturesPage, and the six Issue Tracker
// section pages. The route params carry the (projectId, envSlug) pair,
// so the same one-liner drops into any of the eight headers.
//
// `actions` gates the icon pair — only FeaturesPage passes it (user
// asked, 2026-10-01: edit/delete live on the features page alone), the
// other seven headers render the badge only. The badge always shows the
// FULL row label — the short Dev/Stg forms stay on the project-card
// chips (EnvironmentChips).
//
// The icons are manager-only, matching the mutation hooks' own guards:
// `useUpdateEnvironment` / `useDeleteEnvironment` throw the same error for
// stale modals or programmatic callers. Both envs' modals live here —
// RenameEnvModal for the label/slug edit, DeleteEnvDialog for the
// child-cascade delete (which navigates back to the top-level projects
// list after success, since the route the user was standing on stops
// existing).
//
// Badge treatment comes from `resolveEnvMetaFromEnvs` (row data — verbatim
// label, kind-based class, custom-env tint). Unknown/deleted slugs resolve
// to the neutral badge, so a stale deep link still renders — but with no
// row identity the icons hide (there's nothing to rename or delete).

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RenameEnvModal } from "@/components/project/RenameEnvModal";
import { DeleteEnvDialog } from "@/components/project/DeleteEnvDialog";
import {
  PROJECT_ENV_META,
  resolveEnvMetaFromEnvs,
  type CanonicalEnvSlug,
} from "@/pages/ProjectDetailPage";
import { useEnvironments } from "@/lib/blocks/hooks";
import { useIsRole } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";

// Shared trigger styling — the header pencil's existing treatment
// (h-7 w-7, muted → accent on hover) with a destructive tint for the
// trash so the two read as a matched pair.
const triggerClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const trashClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EnvHeaderChip({ actions = false }: { actions?: boolean }) {
  const { projectId, envSlug } = useParams<{
    projectId: string;
    envSlug: string;
  }>();
  const t = useT();
  const navigate = useNavigate();
  const isManager = useIsRole("manager");

  // The env rows power the badge treatment + the modals' row identity.
  // React Query dedupes this with the page's own env reads — one network
  // call however many headers render the chip.
  const envsQuery = useEnvironments(envSlug ? (projectId ?? null) : null);
  const envRows = envsQuery.data ?? [];
  const meta = envSlug && projectId
    ? resolveEnvMetaFromEnvs(envSlug, envRows)
    : null;

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!projectId || !envSlug || !meta) return null;

  // Same label rule as ProjectDetailPage's header: row data renders
  // verbatim; canonical labels translate UNLESS they're row/override data.
  // The optional chain keeps an unknown slug (neutral meta, no
  // PROJECT_ENV_META entry) from crashing the lookup.
  const badgeLabel =
    meta.verbatim || meta.isCustom || meta.hasOverride
      ? meta.label
      : t(
          PROJECT_ENV_META[meta.slug as CanonicalEnvSlug]?.i18nKey ??
            meta.label,
          meta.label,
        );

  // Manager + row identity gate. `environmentId` is undefined while the
  // env list loads (or for an unknown slug) — hiding the icons there is
  // the honest state: there's no row to point either mutation at yet.
  const canManage = isManager && Boolean(meta.environmentId);

  return (
    <>
      <Badge
        className={meta.className}
        style={meta.customStyle}
        aria-label={badgeLabel}
      >
        {badgeLabel}
      </Badge>
      {actions && canManage && (
        <>
          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            aria-label={t("env.renameTitle", "Rename Environment")}
            title={t("env.renameTitle", "Rename Environment")}
            className={triggerClass}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            aria-label={t("env.deleteTitle", "Delete environment?")}
            title={t("env.deleteConfirm", "Delete environment")}
            className={trashClass}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      )}
      {meta.environmentId && (
        <>
          <RenameEnvModal
            open={renameOpen}
            onClose={() => setRenameOpen(false)}
            projectId={projectId}
            environmentId={meta.environmentId}
            envSlug={meta.slug}
            currentLabel={meta.label}
            onRenamed={(result) => {
              // A slug rename strands the current URL (the old slug no
              // longer resolves to an Environment row) — follow the rename
              // to the new slug's features page, matching the env-chip
              // click target on the project card. Label-only renames just
              // refresh in place via the query invalidation.
              if (result.oldSlug && result.oldSlug !== result.newSlug) {
                navigate(`/projects/${projectId}/${result.newSlug}/features`);
              }
            }}
          />
          <DeleteEnvDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            projectId={projectId}
            environmentId={meta.environmentId}
            label={meta.label}
            onDeleted={() => navigate("/projects")}
          />
        </>
      )}
    </>
  );
}
