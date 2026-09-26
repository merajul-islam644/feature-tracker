// Confirm-then-delete dialog for a single notepad pad. Built from
// the shared Dialog primitives so it matches the rest of the app's
// confirmation dialogs (see DeleteFeatureDialog for the canonical
// pattern). The dialog is parameterized by title / description /
// confirm label so both Plain Text and Excel can reuse it with
// tool-specific copy.
//
// `padName` is shown in a highlighted box below the description so
// the user can confirm they're deleting the right one — pads are
// small but names can collide ("Notes", "Untitled pad", etc.).

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
import { useT } from "@/lib/blocks/i18n";

interface NotepadDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Translation key for the dialog title (e.g. "Delete plain-text
   *  pad?"). */
  titleKey: string;
  titleFallback: string;
  /** Translation key for the description copy. */
  descriptionKey: string;
  descriptionFallback: string;
  /** Translation key for the destructive confirm button label. */
  confirmLabelKey: string;
  confirmLabelFallback: string;
  /** Display name shown in the highlighted confirmation box. Falls
   *  back to "Untitled pad" / "Untitled grid" for pads with no
   *  user-supplied name (legacy migration / empty input). */
  padName: string;
}

export function NotepadDeleteDialog({
  open,
  onClose,
  onConfirm,
  titleKey,
  titleFallback,
  descriptionKey,
  descriptionFallback,
  confirmLabelKey,
  confirmLabelFallback,
  padName,
}: NotepadDeleteDialogProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="sm">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>{t(titleKey, titleFallback)}</DialogTitle>
          <DialogDescription>
            {t(descriptionKey, descriptionFallback)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
            {padName}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel", "Cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t(confirmLabelKey, confirmLabelFallback)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
