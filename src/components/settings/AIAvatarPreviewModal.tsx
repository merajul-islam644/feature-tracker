// AI avatar preview modal — renders the user's original photo on the left
// and the Replicate-stylized version on the right, with a style picker up
// top. The user picks a style, watches the right side fill in, then
// either commits (Use this), retries (Try another style), or cancels.
//
// The actual upload-to-Blocks-Storage happens in `AIAvatarButton` AFTER
// the user picks "Use this" — the modal just owns the preview/retry UX
// and returns the chosen data URL + style to the parent. Splitting those
// responsibilities keeps the modal a pure "review" surface with no
// network state outside of the Replicate round-trip.

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  AVATAR_STYLES,
  generateAvatar,
  type AvatarStyle,
  type GenerateAvatarResult,
} from "@/lib/ai/avatarGenerator";

// Hard cap on retries per session. After this many generations the
// "Try another" button disables so a runaway click loop can't burn
// Replicate credits — matches the safety guard in the original plan.
const MAX_ATTEMPTS = 3;

interface AIAvatarPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The original picture the user picked. Required while `open` is true;
   *  the modal mounts only when this is non-null in `AIAvatarButton`. */
  sourceFile: File | null;
  /** Called when the user clicks "Use this avatar". The parent is
   *  responsible for the actual upload-to-Storage flow. */
  onApprove: (result: GenerateAvatarResult, style: AvatarStyle) => void;
  /** Per-request credentials from the caller's saved `UserAvatarConfig`
   *  row. Sent on every `generateAvatar` call as `x-ai-avatar-*` headers.
   *  The Settings form keeps these in sync, so by the time the modal
   *  opens they're guaranteed to be present — but the prop is `optional`
   *  for type safety. */
  credentials?: {
    provider: string;
    token: string;
    model?: string;
  };
}

type GenerationState =
  | { kind: "idle" }
  | { kind: "generating"; abort: AbortController }
  | { kind: "ready"; result: GenerateAvatarResult; style: AvatarStyle }
  | { kind: "error"; message: string };

export function AIAvatarPreviewModal({
  open,
  onOpenChange,
  sourceFile,
  onApprove,
  credentials,
}: AIAvatarPreviewModalProps) {
  const [style, setStyle] = useState<AvatarStyle>("3D");
  const [state, setState] = useState<GenerationState>({ kind: "idle" });
  // `attempt` tracks how many generations the user has triggered on this
  // source photo; `MAX_ATTEMPTS` caps it. Resets when the modal closes.
  const [attempt, setAttempt] = useState(0);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  // Hold the in-flight AbortController in a ref so the cleanup effect
  // can abort it on unmount/close without re-creating it on every render.
  const inFlightRef = useRef<AbortController | null>(null);

  // Build a stable object URL for the original photo. Revoked on cleanup
  // so we don't leak memory across opens.
  useEffect(() => {
    if (!sourceFile) {
      setOriginalUrl(null);
      return;
    }
    const url = URL.createObjectURL(sourceFile);
    setOriginalUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [sourceFile]);

  // Reset state on close so reopening the modal starts clean.
  useEffect(() => {
    if (open) return;
    setState({ kind: "idle" });
    setAttempt(0);
    if (inFlightRef.current) {
      inFlightRef.current.abort();
      inFlightRef.current = null;
    }
  }, [open]);

  // Abort in-flight generation on unmount so a closed-mid-generation
  // modal doesn't keep the request alive.
  useEffect(() => {
    return () => {
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, []);

  const runGeneration = async (chosenStyle: AvatarStyle) => {
    if (!sourceFile) return;
    const abort = new AbortController();
    inFlightRef.current?.abort();
    inFlightRef.current = abort;
    setState({ kind: "generating", abort });
    setAttempt((a) => a + 1);
    try {
      const result = await generateAvatar(
        { image: sourceFile, style: chosenStyle },
        abort.signal,
        credentials ? { credentials } : undefined,
      );
      // Guard: another `runGeneration` may have been queued between the
      // `await` resolving and this setState. Only commit if our
      // AbortController is still the active one.
      if (inFlightRef.current === abort) {
        inFlightRef.current = null;
        setState({ kind: "ready", result, style: chosenStyle });
      }
    } catch (err) {
      // Abort errors are intentional — silent.
      if (abort.signal.aborted) return;
      if (inFlightRef.current === abort) {
        inFlightRef.current = null;
        setState({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Avatar generation failed.",
        });
      }
    }
  };

  // Auto-run on first open with the default style — saves the user a
  // click and matches the preview-and-approve UX the user asked for.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!open || !sourceFile || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void runGeneration("3D");
  }, [open, sourceFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset autoStart when the modal fully closes.
  useEffect(() => {
    if (!open) autoStartedRef.current = false;
  }, [open]);

  const isGenerating = state.kind === "generating";
  const canRetry = !isGenerating && attempt < MAX_ATTEMPTS;
  const canApprove = state.kind === "ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          inFlightRef.current?.abort();
          inFlightRef.current = null;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Generate AI avatar
          </DialogTitle>
          <DialogDescription>
            Turn your photo into a stylized version. Pick a style below
            and preview the result before saving.
          </DialogDescription>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Style picker. Compact chip row — fits nine presets on a
              single line on desktop, wraps on narrower viewports. */}
          <div
            role="radiogroup"
            aria-label="Avatar style"
            className="flex flex-wrap gap-1.5"
          >
            {AVATAR_STYLES.map((opt) => {
              const active = style === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={isGenerating}
                  onClick={() => setStyle(opt.value)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-foreground hover:bg-accent",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Side-by-side preview. Equal-height cards so the original
              and generated photos line up regardless of aspect ratio. */}
          <div className="grid grid-cols-2 gap-3">
            <PreviewCard
              label="Original"
              imageUrl={originalUrl}
              loading={false}
            />
            <PreviewCard
              label="Generated"
              imageUrl={
                state.kind === "ready" ? state.result.avatarDataUrl : null
              }
              loading={isGenerating}
              error={state.kind === "error" ? state.message : null}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This usually takes 10–30 seconds. Replicate charges per
            generation, so retries are capped at {MAX_ATTEMPTS} per photo.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canRetry}
            onClick={() => void runGeneration(style)}
          >
            Try another
          </Button>
          <Button
            type="button"
            disabled={!canApprove}
            onClick={() => {
              if (state.kind !== "ready") return;
              onApprove(state.result, state.style);
            }}
          >
            Use this avatar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PreviewCardProps {
  label: string;
  imageUrl: string | null;
  loading: boolean;
  error?: string | null;
}

function PreviewCard({ label, imageUrl, loading, error }: PreviewCardProps) {
  return (
    <div className="flex flex-col">
      <span className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={label}
            className="h-full w-full object-cover"
          />
        ) : loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2
              className="h-6 w-6 animate-spin text-primary"
              aria-hidden="true"
            />
            <span className="text-xs">Generating…</span>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-destructive">
            {error}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            —
          </div>
        )}
      </div>
    </div>
  );
}
