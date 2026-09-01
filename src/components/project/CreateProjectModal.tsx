import { useState } from "react";
import { Plus, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { projectNameSchema, validateFeatureName } from "@/lib/validation";
import { useDataStore } from "@/store/dataStore";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { delay } from "@/lib/utils";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

interface FeatureInputRow {
  id: number;
  value: string;
  error: string | null;
}

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const addProject = useDataStore((s) => s.addProject);
  const { currentUser } = useAuth();
  const toast = useToast();

  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureInputRow[]>([
    { id: 1, value: "", error: null },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [nextId, setNextId] = useState(2);

  const reset = () => {
    setProjectName("");
    setProjectError(null);
    setFeatures([{ id: 1, value: "", error: null }]);
    setNextId(2);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    reset();
    onClose();
  };

  const handleAddFeature = () => {
    setFeatures((rows) => [...rows, { id: nextId, value: "", error: null }]);
    setNextId((n) => n + 1);
  };

  const handleRemoveFeature = (id: number) => {
    setFeatures((rows) =>
      rows.length > 1 ? rows.filter((r) => r.id !== id) : rows
    );
  };

  const handleFeatureChange = (id: number, value: string) => {
    setFeatures((rows) =>
      rows.map((r) => (r.id === id ? { ...r, value, error: null } : r))
    );
  };

  const validateAll = (): boolean => {
    const result = projectNameSchema.safeParse(projectName);
    if (!result.success) {
      setProjectError(result.error.issues[0]?.message ?? "Invalid name");
      return false;
    }
    setProjectError(null);

    let valid = true;
    const trimmedValues = features.map((r) => r.value.trim());

    setFeatures((rows) =>
      rows.map((row) => {
        const error = validateFeatureName(row.value, trimmedValues);
        if (error) valid = false;
        return { ...row, error };
      })
    );

    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll() || !currentUser) return;

    setSubmitting(true);
    await delay(500);

    const featureNames = features
      .map((r) => r.value.trim())
      .filter((n) => n.length > 0);

    const project = addProject(projectName, currentUser.id, featureNames);
    toast.success(`Project "${project.name}" created successfully.`);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Add a project name and optional initial features.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="create-project-form"
            onSubmit={handleSubmit}
            className="space-y-5"
            noValidate
          >
            <Input
              label="Project Name"
              required
              placeholder="e.g. Marketing Website"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                if (projectError) setProjectError(null);
              }}
              error={projectError ?? undefined}
              autoFocus
              maxLength={100}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Features</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <div className="space-y-2">
                {features.map((row) => (
                  <div key={row.id} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="Feature name"
                        value={row.value}
                        onChange={(e) =>
                          handleFeatureChange(row.id, e.target.value)
                        }
                        error={row.error ?? undefined}
                        maxLength={100}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFeature(row.id)}
                      disabled={features.length === 1}
                      aria-label="Remove feature input"
                      className="mt-1.5 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddFeature}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Feature
              </button>
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-project-form"
            loading={submitting}
          >
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
