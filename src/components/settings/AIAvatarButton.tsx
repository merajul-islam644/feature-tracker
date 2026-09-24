// Triggers the AI avatar generation flow. Sits next to the existing
// `ProfilePictureUpload` button on the Settings page — same row, same
// target (the caller's own UserProfile row), independent of the manual
// upload flow so either path can save the picture without conflicting
// with the other.
//
// Capability probe at mount: pings `/api/ai/avatar` with an empty body
// to learn whether the proxy has `REPLICATE_API_TOKEN` set. When
// unconfigured the proxy returns 503 and we render nothing — keeps
// the UI honest about feature availability on this environment, the
// same pattern `VITE_USE_REAL_VERIFY` gates the Issue Tracker chat.

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { useUploadAiAvatar } from "@/lib/blocks/hooks";
import {
  probeAvatarAvailable,
  type GenerateAvatarResult,
  type AvatarStyle,
} from "@/lib/ai/avatarGenerator";
import { AIAvatarPreviewModal } from "./AIAvatarPreviewModal";

// Max 4 MB at the picker — mirrors `ProfilePictureUpload` so the two
// paths can't disagree on what's acceptable input.
const MAX_BYTES = 4 * 1024 * 1024;

export function AIAvatarButton() {
  const t = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const upload = useUploadAiAvatar();

  // Probe on mount — single round trip. `available === null` while
  // pending so we render nothing instead of a button that may
  // immediately 503. `available === false` after the probe completes
  // → render nothing permanently.
  useEffect(() => {
    let cancelled = false;
    void probeAvatarAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still triggers onChange.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(
        t(
          "settings.account.uploadInvalid",
          "Please pick an image file.",
        ),
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(
        t(
          "settings.account.uploadTooLarge",
          "Image must be 4 MB or smaller.",
        ),
      );
      return;
    }
    setSourceFile(file);
    setModalOpen(true);
  };

  const handleApprove = async (
    result: GenerateAvatarResult,
    style: AvatarStyle,
  ) => {
    setModalOpen(false);
    setSourceFile(null);
    try {
      await upload.mutateAsync({
        dataUrl: result.avatarDataUrl,
        style,
      });
      toast.success(
        t(
          "settings.account.aiUploadSuccess",
          "AI avatar updated.",
        ),
      );
    } catch (err) {
      toast.error(
        t(
          "settings.account.aiUploadError",
          "Couldn't save AI avatar: {message}",
          { message: err instanceof Error ? err.message : String(err) },
        ),
      );
    }
  };

  // Don't render at all when the proxy is unconfigured or still being
  // probed — same pattern as the existing upload button when the
  // signed-in user is missing, but driven by capability instead of
  // auth state.
  if (available !== true) return null;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onPick}
        disabled={upload.isPending}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="ml-2"
      >
        <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {t("settings.account.aiUpload", "Generate AI avatar")}
      </Button>

      <AIAvatarPreviewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        sourceFile={sourceFile}
        onApprove={handleApprove}
      />
    </>
  );
}
