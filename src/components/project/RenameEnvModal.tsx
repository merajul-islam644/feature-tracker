// Inline rename dialog for a project env — two Input fields (label + slug),
// validates the label with nameSchema and the slug with validateEnvSlug,
// persists via useUpdateEnvironment.
//
// The pencil trigger that opens this lives in the `/projects/:id/:envSlug`
// page header next to the env Badge; see ProjectDetailPage.tsx.
//
// Under schema v2.1 the slug is editable for EVERY env — canonical
// included. The env's row ItemId (`environmentId`) is the identity its
// per-env data (verification checks, active-env preference) hangs off,
// so those survive untouched. The slug itself is still read by every
// env-scoped list (features/flows/targets/secrets/bindings/issues), so
// `useUpdateEnvironment` migrates those rows to the new slug as part of
// the same mutation — children first, Environment row last.
//
// The "rename to itself" short-circuit from RenameProjectModal applies
// here too: if both label and slug are unchanged the modal just closes
// without a network round-trip.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  useEnvironments,
  useUpdateEnvironment,
} from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { nameSchema, validateEnvSlug } from "@/lib/validation";

interface RenameEnvModalProps {
  open: boolean;
  onClose: () => void;
  /** The project that owns the env — scopes the slug-uniqueness list. */
  projectId: string;
  // The env's row identity (blx_Environments.ItemId) — what the update
  // mutation targets. Undefined only while the env list is still loading;
  // the submit guards on it.
  environmentId?: string;
  // The slug the user is currently viewing — pre-fills the slug input and
  // detects the "slug changed" case for the post-rename navigation.
  envSlug: string;
  // The current display label. Pre-filled on open. This is row data —
  // the seeded short form for canonical envs, the user's label for
  // custom ones, or an earlier rename of either.
  currentLabel: string;
  // Fires after a successful rename. The page uses this to navigate to
  // the new slug when the slug changed — the modal can't do that itself
  // because it doesn't own the router. Fires once per submit; the
  // mutation hook has already invalidated the affected queries by the
  // time this is called.
  onRenamed?: (result: { newSlug: string; oldSlug?: string }) => void;
}

export function RenameEnvModal({
  open,
  onClose,
  projectId,
  environmentId,
  envSlug,
  currentLabel,
  onRenamed,
}: RenameEnvModalProps) {
  const updateEnv = useUpdateEnvironment();
  const toast = useToast();
  const t = useT();

  const [label, setLabel] = useState(currentLabel);
  const [slug, setSlug] = useState(envSlug);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the inputs every time the dialog re-opens so the user always
  // sees the latest server values, never a stale edit from a previous
  // session. Same pattern as RenameProjectModal / RenameFeatureModal.
  useEffect(() => {
    if (open) {
      setLabel(currentLabel);
      setSlug(envSlug);
      setLabelError(null);
      setSlugError(null);
      setSubmitting(false);
    }
  }, [open, currentLabel, envSlug]);

  // The project's env rows power duplicate detection. The env being
  // renamed is excluded — passing it would produce a self-match on every
  // keystroke once the user has typed the current slug. Under v2.1 the
  // canonical slugs are rows too, so listing the project's envs covers
  // them without a hardcoded reserved list.
  const envsQuery = useEnvironments(open ? projectId : null);
  const existingSlugs = useMemo<string[]>(() => {
    return (envsQuery.data ?? [])
      .map((e) => e.slug)
      .filter((s) => s !== envSlug);
  }, [envsQuery.data, envSlug]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedLabel = label.trim();
    const trimmedSlug = slug.trim().toLowerCase();

    // Validate label.
    const labelResult = nameSchema.safeParse(trimmedLabel);
    if (!labelResult.success) {
      setLabelError(labelResult.error.issues[0]?.message ?? "Invalid name");
      return;
    }

    // Validate slug. Editable for every env under v2.1 — the mutation
    // migrates the env's child rows to the new slug, so the rename is
    // safe wherever it's pointed at from. The env's own kind rides
    // along: `slug === kind` is the one canonical slug a row may hold
    // (AddEnvironmentModal seeds it that way), and without the kind the
    // reserved check rejects an UNCHANGED canonical slug — blocking a
    // label-only rename of every seeded env (verified live 2026-10-02).
    const envKind = envsQuery.data?.find((e) => e.id === environmentId)?.kind;
    const slugErr = validateEnvSlug(trimmedSlug, existingSlugs, envKind);
    if (slugErr) {
      setSlugError(slugErr);
      return;
    }

    // No-op: label and slug both unchanged. Short-circuit to match the
    // other rename modals — no network round-trip when there's nothing
    // to save.
    const slugUnchanged = trimmedSlug === envSlug;
    const labelUnchanged = trimmedLabel === currentLabel;
    if (slugUnchanged && labelUnchanged) {
      onClose();
      return;
    }

    if (!environmentId) {
      // The env list hadn't resolved when the modal opened — no row
      // identity to update. Re-opening after the list lands fixes it.
      toast.error(
        t(
          "env.renameError",
          "Could not rename environment.",
        ),
      );
      return;
    }

    setLabelError(null);
    setSlugError(null);
    setSubmitting(true);
    try {
      await updateEnv.mutateAsync({
        id: environmentId,
        projectId,
        label: trimmedLabel,
        ...(slugUnchanged ? {} : { slug: trimmedSlug }),
      });
      if (!slugUnchanged) {
        toast.success(
          t("toast.envSlugChanged", 'Environment moved to "{slug}".', {
            slug: trimmedSlug,
          }),
        );
      } else {
        toast.success(
          t("toast.envRenamed", 'Environment renamed to "{label}".', {
            label: trimmedLabel,
          }),
        );
      }
      onRenamed?.({
        newSlug: trimmedSlug,
        oldSlug: slugUnchanged ? undefined : envSlug,
      });
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("env.renameError", "Could not rename environment."),
      );
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>{t("env.renameTitle", "Rename Environment")}</DialogTitle>
          <DialogDescription>
            {t(
              "env.renameDescription",
              "Update the display label and URL slug.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="rename-env-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            <Input
              label={t("env.labelLabel", "Display label")}
              required
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError) setLabelError(null);
              }}
              error={labelError ?? undefined}
              autoFocus
              maxLength={100}
            />
            <Input
              label={t("env.slugLabel", "URL slug")}
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                if (slugError) setSlugError(null);
              }}
              error={slugError ?? undefined}
              hint={t(
                "env.slugHelp",
                "Lowercase letters, digits, and dashes. Used in the URL. Renaming the slug keeps every reference — environments are tracked by id.",
              )}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {t("cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            form="rename-env-form"
            loading={submitting}
          >
            {t("save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
