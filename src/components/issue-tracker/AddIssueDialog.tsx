import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { useCreateIssue, useProject } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import type { IssueCategory, IssueSeverity } from "@/types/issue-tracker";

interface AddIssueDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  envSlug: string;
}

const severities: { value: IssueSeverity; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const categories: { value: IssueCategory; label: string }[] = [
  { value: "authentication", label: "Authentication" },
  { value: "authorization", label: "Authorization" },
  { value: "navigation", label: "Navigation" },
  { value: "ui", label: "UI" },
  { value: "functional", label: "Functional" },
  { value: "forms", label: "Forms" },
  { value: "api", label: "API" },
  { value: "performance", label: "Performance" },
  { value: "accessibility", label: "Accessibility" },
  { value: "other", label: "Other" },
];

const TEXTAREA_CLASS =
  "w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

// Manual issue entry — the human counterpart to the AI verification
// run's auto-insert. Every role (developer / tester / manager) can file
// an issue from this dialog; the row lands in the same Blocks schema
// (`useCreateIssue`) with `status: "open"` and no verification linkage
// (no `verificationRunId`, no `fingerprint`) so it never collides with
// the run-dedup logic and starts unapproved, exactly like the sidebar's
// workflow expects: a tester approves it before it becomes assignable
// to developers.
//
// Application is NOT a free-text field: manual issues are always filed
// from inside a project env, so the Application name is the project's
// own name (user request 2026-11-24) — pre-filled and disabled so it
// can't drift from the scope the user is already in.
export function AddIssueDialog({
  open,
  onClose,
  projectId,
  envSlug,
}: AddIssueDialogProps) {
  const createIssue = useCreateIssue();
  const toast = useToast();
  const t = useT();
  const projectQuery = useProject(projectId);
  const projectName = projectQuery.data?.name ?? "";

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<IssueCategory>("other");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  // One step per line — split on newlines at submit; blank lines drop.
  const [reproductionDraft, setReproductionDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setUrl("");
      setCategory("other");
      setSeverity("medium");
      setDescription("");
      setExpected("");
      setActual("");
      setReproductionDraft("");
      setError(null);
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (createIssue.isPending) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("issueTracker.issues.addTitleRequired", "Title is required."));
      return;
    }
    if (!description.trim()) {
      setError(
        t("issueTracker.issues.addDescriptionRequired", "Description is required."),
      );
      return;
    }

    const reproductionSteps = reproductionDraft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await createIssue.mutateAsync({
        // Env scoping — the scoped read drops rows without these, so
        // they're stamped from the route's env context, same as the AI
        // insert path.
        projectId,
        envSlug,
        title: title.trim(),
        // Always the scoped project's own name (see the component note).
        // The submit button stays disabled until the name resolves, so
        // this only fires with a real value.
        applicationName: projectName,
        // The Issue schema's `url` field carries a Required validation on
        // the gateway — an empty string bounces with VALIDATION_ERROR
        // ("Field 'url' is required for insert"; verified against the
        // live 200-wrapped GraphQL errors array). Manual entries without
        // a URL (config/build defects etc.) send the "N/A" sentinel so
        // the insert passes; the details drawer shows it as plain text.
        url: url.trim() || "N/A",
        category,
        severity,
        // Manual entries always start at the front of the triage queue.
        status: "open",
        description: description.trim(),
        // Optional content fields — omitted (not empty-stringed) so the
        // row stays clean NULL, same convention as the AI insert.
        ...(expected.trim() ? { expected: expected.trim() } : {}),
        ...(actual.trim() ? { actual: actual.trim() } : {}),
        ...(reproductionSteps.length > 0
          ? { reproductionSteps }
          : {}),
        detectedAt: new Date().toISOString(),
        // Deliberately omitted: verificationRunId, fingerprint,
        // occurrenceCount, lastSeenAt, seenInRunIds — those belong to the
        // run-dedup machinery; manual rows are one-time human reports.
      });
      toast.success(
        t("issueTracker.issues.added", "Issue added successfully."),
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("issueTracker.issues.addFailed", "Could not add the issue."),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Viewport-constrained: the grid-rows template pins the header
          and footer while the body (min-h-0 + overflow-y-auto) takes
          whatever space remains — the form is tall, so on short windows
          the body scrolls INTERNALLY and the Cancel / Add issue footer
          stays visible without any page or dialog-level scrolling. */}
      <DialogContent
        size="md"
        className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <DialogHeader>
          <DialogTitle>
            {t("issueTracker.issues.addTitle", "Add issue")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "issueTracker.issues.addDescription",
              "File a defect by hand — any role can report one. It enters the same triage flow as auto-detected issues.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto">
          <form
            id="add-issue-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            <Input
              label={t("issueTracker.issues.titleLabel", "Title")}
              required
              placeholder={t(
                "issueTracker.issues.titlePlaceholder",
                "e.g. Checkout button does nothing on empty cart",
              )}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              maxLength={200}
              autoFocus
            />
            {/* Locked to the scoped project's name — the issue is being
                filed from inside this project's env, so the application
                can't drift from the scope (user request 2026-11-24). */}
            <Input
              label={t("issueTracker.issues.applicationLabel", "Application")}
              value={projectName}
              disabled
              placeholder={t(
                "issueTracker.issues.applicationLoading",
                "Project name…",
              )}
              aria-readonly="true"
            />
            <Input
              label={t("issueTracker.issues.urlLabel", "URL (optional)")}
              type="url"
              placeholder="https://app.example.com/checkout"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t("issueTracker.issues.severityLabel", "Severity")}
                required
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
                options={severities}
              />
              <Select
                label={t("issueTracker.issues.categoryLabel", "Category")}
                required
                value={category}
                onChange={(e) => setCategory(e.target.value as IssueCategory)}
                options={categories}
              />
            </div>
            <div>
              <label
                htmlFor="add-issue-description"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                {t("issueTracker.issues.descriptionLabel", "Description")}{" "}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </label>
              <textarea
                id="add-issue-description"
                required
                rows={3}
                placeholder={t(
                  "issueTracker.issues.descriptionPlaceholder",
                  "What is broken, where, and how it behaves now…",
                )}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (error) setError(null);
                }}
                className={TEXTAREA_CLASS}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="add-issue-expected"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  {t("issueTracker.issues.expectedLabel", "Expected (optional)")}
                </label>
                <textarea
                  id="add-issue-expected"
                  rows={2}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  className={TEXTAREA_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor="add-issue-actual"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  {t("issueTracker.issues.actualLabel", "Actual (optional)")}
                </label>
                <textarea
                  id="add-issue-actual"
                  rows={2}
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="add-issue-steps"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                {t(
                  "issueTracker.issues.stepsLabel",
                  "Reproduction steps (optional — one per line)",
                )}
              </label>
              <textarea
                id="add-issue-steps"
                rows={3}
                placeholder={t(
                  "issueTracker.issues.stepsPlaceholder",
                  "1. Open the cart\n2. Click Checkout\n3. Nothing happens",
                )}
                value={reproductionDraft}
                onChange={(e) => setReproductionDraft(e.target.value)}
                className={TEXTAREA_CLASS}
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createIssue.isPending}
          >
            {t("cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            form="add-issue-form"
            loading={createIssue.isPending || !projectName}
          >
            {createIssue.isPending
              ? t("issueTracker.issues.adding", "Adding…")
              : t("issueTracker.issues.add", "Add issue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
