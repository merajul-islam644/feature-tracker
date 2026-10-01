// Name-prompt dialog shared by the two notepad tools (Plain Text and
// Excel). The user clicks Create on the empty state; this dialog
// collects the pad's display name; on submit, the parent initializes
// the pad in localStorage with that name and the editor takes over.
//
// The dialog is intentionally tiny: one required text input, Cancel +
// Create. No toolbar, no description preview — the dialog's
// description explains *why* a name is needed so the user can move on.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/blocks/i18n";

interface NotepadCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the trimmed name when the user submits a non-empty
   *  value. The parent owns the persistence + UI flip from here. */
  onSubmit: (name: string) => void;
  /** Title shown in the dialog header — varies per tool ("Create
   *  Plain Text Pad" vs "Create Excel Grid"). Translation key +
   *  English fallback pair so the dialog works even if the key is
   *  missing from a locale. */
  titleKey: string;
  titleFallback: string;
  /** Placeholder shown inside the name input — also tool-specific. */
  placeholderKey: string;
  placeholderFallback: string;
}

export function NotepadCreateModal({
  open,
  onClose,
  onSubmit,
  titleKey,
  titleFallback,
  placeholderKey,
  placeholderFallback,
}: NotepadCreateModalProps) {
  const t = useT();
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  // Reset input + error each time the dialog opens so a previous
  // attempt (or a Cancel) doesn't bleed into a fresh open. The
  // `open` flag flips true on each open and false on each close, so
  // depending on it triggers a reset on both transitions — fine
  // because the reset is a no-op when nothing's set.
  useEffect(() => {
    if (open) {
      setNameInput("");
      setNameError(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed === "") {
      setNameError(
        t("notepad.createDialog.nameRequired", "Please enter a name"),
      );
      return;
    }
    onSubmit(trimmed);
  };

  // Radix fires `onOpenChange(false)` for Escape, overlay click,
  // and our Cancel button alike — funnel all of those through
  // `onClose` so the parent owns the open state.
  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t(titleKey, titleFallback)}</DialogTitle>
          <DialogDescription>
            {t(
              "notepad.createDialog.description",
              "Give your pad a name so you can find it later.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="notepad-create-form"
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
          >
            <Input
              label={t("notepad.createDialog.nameLabel", "Name")}
              placeholder={t(placeholderKey, placeholderFallback)}
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                // Clear validation error as soon as the user starts
                // typing again — they'd rather not see the red ring
                // for a typo they already corrected.
                if (nameError) setNameError(null);
              }}
              error={nameError ?? undefined}
              autoFocus
              required
              maxLength={100}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel", "Cancel")}
          </Button>
          <Button type="submit" form="notepad-create-form">
            {t("notepad.create", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
